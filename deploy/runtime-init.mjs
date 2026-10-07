// Run once as container root with only the two named volumes mounted.
// No wallet key, host mount, network request or secret in stdout.
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { runtimeConfigSchema, runtimeDirectory } from './runtime-config.mjs';

const config = runtimeConfigSchema.parse(JSON.parse(process.argv[2] || '{}'));
for (const name of ['workspace.json', 'service.token']) {
  try { await fs.access(`${runtimeDirectory}/${name}`); throw Error('CONFIG_ALREADY_EXISTS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await fs.chmod(runtimeDirectory, 0o750);
await fs.chown(runtimeDirectory, 0, 10003);
await fs.mkdir('/data/reports', { recursive: true });
await fs.chmod('/data/reports', 0o700);
await fs.chown('/data/reports', 10001, 10003);
await fs.writeFile(`${runtimeDirectory}/workspace.json`, JSON.stringify(config, null, 2), { mode: 0o640, flag: 'wx', flush: true });
await fs.writeFile(`${runtimeDirectory}/service.token`, randomBytes(32).toString('base64url'), { mode: 0o640, flag: 'wx', flush: true });
await fs.chown(`${runtimeDirectory}/workspace.json`, 0, 10003);
await fs.chown(`${runtimeDirectory}/service.token`, 0, 10003);
console.log(JSON.stringify({ initialized: true, network: config.network, sourceId: config.sourceId, signingKeys: false }));
