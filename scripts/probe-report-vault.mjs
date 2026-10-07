#!/usr/bin/env node
// Real stdio MCP + separate HTTP service + finalized public GenLayer reads.
// No signing key, chain write, provider order or independent user is involved.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { sha256 } from '../agents/inspector.mjs';

const contract = '0x91883d4829E5b5bD7BED6eBd0EceF927A71942d6', source = 'MOBILE-QA-20261001-1057', workflowId = 'MOBILE-QA-WF-20261001';
const args = ['--network', 'studionet', '--contract', contract, '--source', source];
const baseEnv = getDefaultEnvironment();
for (const key of ['NODE_USE_ENV_PROXY','NODE_EXTRA_CA_CERTS','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY','https_proxy','http_proxy','all_proxy','no_proxy']) if (process.env[key]) baseEnv[key] = process.env[key];
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'proofguard-live-vault-'));
const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const token = randomBytes(32).toString('base64url'), endpoint = `http://127.0.0.1:${port}`;
const serviceEnv = { ...baseEnv, PROOFGUARD_REPORT_PORT: String(port), PROOFGUARD_REPORT_TOKEN: token, PROOFGUARD_REPORT_DIR: temporary, PROOFGUARD_REPORT_WORKFLOWS: workflowId };
const vault = spawn(process.execPath, [fileURLToPath(new URL('../services/report-vault.mjs', import.meta.url)), ...args], { env: serviceEnv, stdio: ['ignore', 'ignore', 'pipe'] });
const client = new Client({ name: 'proofguard-real-service-probe', version: '1' });
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('VAULT_START_TIMEOUT')), 10000);
    vault.stderr.on('data', chunk => { if (String(chunk).includes('listening')) { clearTimeout(timeout); resolve(); } });
    vault.once('exit', () => { clearTimeout(timeout); reject(Error('VAULT_START_FAILED')); });
  });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../agents/mcp-server.mjs', import.meta.url)), ...args, '--enable-delivery'],
    env: { ...baseEnv, PROOFGUARD_REPORT_TOKEN: token, PROOFGUARD_REPORT_ENDPOINT: endpoint }, stderr: 'inherit' });
  await client.connect(transport);
  const call = (name, input) => client.callTool({ name, arguments: input }, undefined, { timeout: 60000 });
  const checked = await call('proofguard_get_output', { workflowId, jobId: 'weekday-price', expectedRevision: 1 });
  assert(!checked.isError, JSON.stringify(checked));
  const input = { workflowId, jobId: 'weekday-price', expectedRevision: 1, expectedOutputSha256: checked.structuredContent.sha256 };
  const delivered = await call('proofguard_deliver_report', input); assert(!delivered.isError, JSON.stringify(delivered));
  const repeated = await call('proofguard_deliver_report', input); assert(!repeated.isError && repeated.structuredContent.reused);
  const id = delivered.structuredContent.deliveryId;
  const download = await fetch(`${endpoint}/v1/reports/${id}/content`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(download.status, 200); assert.equal(sha256(await download.text()), input.expectedOutputSha256);
  assert.equal((await fetch(`${endpoint}/v1/reports`, { method: 'POST', body: JSON.stringify(input) })).status, 401);
  const held = await call('proofguard_deliver_report', { ...input, jobId: 'weekend-price' }); assert(held.isError);
  const report = { observedAt: new Date().toISOString(), mode: 'LIVE_MCP_HTTP_SERVICE_FINALIZED_RPC', chainId: 61999, contract, sourceId: source,
    workflowId, jobId: input.jobId, sourceRevision: 1, outputSha256: input.expectedOutputSha256, deliveryId: id,
    independentServiceRead: true, storedReports: (await fs.readdir(temporary)).filter(f => f.endsWith('.json')).length,
    repeatedRequestDeduplicated: true, downloadedBytesMatch: true, unauthenticatedRejected: true, heldJobRejected: held.structuredContent.error,
    transactionsSubmitted: 0, limitation: 'Developer-run local HTTP service, using an existing live artifact. Not a hosted production integration, new signed management lifecycle, or independent developer pilot.' };
  await fs.mkdir('outputs', { recursive: true });
  await fs.writeFile('outputs/report-vault-live-probe.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
  if (vault.exitCode === null && vault.signalCode === null) { vault.kill(); await once(vault, 'exit'); }
  await fs.rm(temporary, { recursive: true, force: true });
}
