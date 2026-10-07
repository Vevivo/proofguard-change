import { fileURLToPath } from 'node:url';
import { readRuntimeConfig, readRuntimeToken, workspaceArgs } from './runtime-config.mjs';

const mode = process.argv[2];
if (mode === 'health') {
  const r = await fetch('http://127.0.0.1:8788/health', { signal: AbortSignal.timeout(4000) });
  const data = await r.json();
  if (!r.ok || data.service !== 'proofguard-report-vault' || data.status !== 'listening') process.exitCode = 1;
} else if (['vault', 'mcp'].includes(mode)) {
  const config = await readRuntimeConfig();
  process.env.PROOFGUARD_REPORT_TOKEN = await readRuntimeToken();
  process.env.PROOFGUARD_REPORT_ENDPOINT = 'http://127.0.0.1:8788';
  process.env.PROOFGUARD_REPORT_PORT = '8788';
  process.env.PROOFGUARD_REPORT_DIR = '/data/reports';
  process.env.PROOFGUARD_REPORT_WORKFLOWS = config.workflowIds.join(',');
  // Server deployment keeps signing in the owner's browser wallet.
  delete process.env.GENLAYER_MANAGER_KEY;
  delete process.env.GENLAYER_EXECUTOR_KEY;
  const moduleUrl = new URL(mode === 'vault' ? '../services/report-vault.mjs' : '../agents/mcp-server.mjs', import.meta.url);
  process.argv = [process.execPath, fileURLToPath(moduleUrl), ...workspaceArgs(config), ...(mode === 'mcp' ? ['--enable-delivery'] : [])];
  await import(moduleUrl.href);
} else {
  console.error('Choose vault, mcp or health.'); process.exitCode = 1;
}
