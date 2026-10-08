#!/usr/bin/env node
// Local service + real stdio MCP + existing finalized Studionet output. No signing.
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

const contract = '0x91883d4829E5b5bD7BED6eBd0EceF927A71942d6';
const source = 'MOBILE-QA-20261001-1057', workflowId = 'MOBILE-QA-WF-20261001';
const args = ['--network', 'studionet', '--contract', contract, '--source', source];
const baseEnv = getDefaultEnvironment();
for (const key of ['NODE_USE_ENV_PROXY', 'NODE_EXTRA_CA_CERTS', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy']) if (process.env[key]) baseEnv[key] = process.env[key];
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'proofguard-live-monitor-'));
const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const token = randomBytes(32).toString('base64url'), endpoint = `http://127.0.0.1:${port}`;
const serviceEnv = { ...baseEnv, PROOFGUARD_REPORT_PORT: String(port), PROOFGUARD_REPORT_TOKEN: token, PROOFGUARD_REPORT_DIR: temporary,
  PROOFGUARD_REPORT_WORKFLOWS: workflowId, PROOFGUARD_REPORT_MONITOR_INTERVAL_MS: '5000', PROOFGUARD_REPORT_FRESHNESS_MS: '120000' };
const vault = spawn(process.execPath, [fileURLToPath(new URL('../services/report-vault.mjs', import.meta.url)), ...args], { env: serviceEnv, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
const client = new Client({ name: 'proofguard-live-monitor-probe', version: '1.0.0' });
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('VAULT_START_TIMEOUT')), 15000);
    vault.stderr.on('data', chunk => { if (String(chunk).includes('listening')) { clearTimeout(timeout); resolve(); } });
    vault.once('exit', () => { clearTimeout(timeout); reject(Error('VAULT_START_FAILED')); });
  });
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../agents/mcp-server.mjs', import.meta.url)), ...args, '--enable-delivery'],
    env: { ...baseEnv, PROOFGUARD_REPORT_TOKEN: token, PROOFGUARD_REPORT_ENDPOINT: endpoint }, stderr: 'inherit' }));
  const call = async (name, input) => {
    const result = await client.callTool({ name, arguments: input }, undefined, { timeout: 65000 });
    assert(!result.isError, JSON.stringify(result)); return result.structuredContent;
  };
  const tools = (await client.listTools()).tools.map(t => t.name);
  for (const tool of ['proofguard_get_report_status', 'proofguard_recheck_report', 'proofguard_get_report_events']) assert(tools.includes(tool));
  const checked = await call('proofguard_get_output', { workflowId, jobId: 'weekday-price', expectedRevision: 1 });
  const input = { workflowId, jobId: 'weekday-price', expectedRevision: 1, expectedOutputSha256: checked.sha256 };
  const delivered = await call('proofguard_deliver_report', input), deliveryId = delivered.deliveryId;
  const first = await call('proofguard_get_report_status', { deliveryId }); assert.equal(first.state, 'CURRENT');
  let automatic = first;
  const deadline = Date.now() + 65000;
  while (Date.now() < deadline && automatic.checkedAt === first.checkedAt) {
    await new Promise(resolve => setTimeout(resolve, 500));
    automatic = await call('proofguard_get_report_status', { deliveryId });
  }
  assert.equal(automatic.state, 'CURRENT'); assert(Date.parse(automatic.checkedAt) > Date.parse(first.checkedAt), 'Automatic scan must refresh observation without download or explicit recheck.');
  const rechecked = await call('proofguard_recheck_report', { deliveryId }); assert.equal(rechecked.state, 'CURRENT');
  const repeated = await call('proofguard_deliver_report', input); assert(repeated.reused); assert.equal(repeated.deliveryId, deliveryId);
  const history = await call('proofguard_get_report_events', { deliveryId, after: 0, limit: 100 });
  assert(history.events.some(event => event.state === 'CURRENT'));
  assert.equal(history.events.filter(event => event.state === 'CURRENT').length, 1, 'Identical observations must not create duplicate current transitions.');
  const afterHistory = await call('proofguard_get_report_events', { deliveryId, after: history.nextCursor, limit: 100 }); assert.equal(afterHistory.events.length, 0);
  const download = await fetch(`${endpoint}/v1/reports/${deliveryId}/content`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(55000) });
  assert.equal(download.status, 200); assert.equal(sha256(await download.text()), input.expectedOutputSha256);
  assert.equal((await fetch(`${endpoint}/v1/reports/${deliveryId}/status`)).status, 401);
  const report = { observedAt: new Date().toISOString(), mode: 'LIVE_MCP_HTTP_REPORT_MONITOR', chainId: 61999, contract,
    sourceId: source, workflowId, jobId: input.jobId, sourceRevision: 1, outputSha256: input.expectedOutputSha256, deliveryId,
    automaticScanVerified: true, firstCheckedAt: first.checkedAt, automaticCheckedAt: automatic.checkedAt,
    explicitRecheckState: rechecked.state, durableEventsRead: history.events, cursorReadVerified: true,
    repeatedDeliveryDeduplicated: true, repeatedCurrentEventDeduplicated: true, downloadedBytesMatch: true,
    unauthenticatedStatusRejected: true, tools, transactionsSubmitted: 0,
    limitation: 'Developer-run local HTTP service and real MCP using existing finalized chain data. Source invalidation, outages, restart and expiry are tested with controlled fixtures, not induced on this public record. No production deployment or independent-user pilot is claimed.' };
  await fs.mkdir('outputs', { recursive: true });
  await fs.writeFile('outputs/report-monitor-live-probe.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
  if (vault.exitCode === null && vault.signalCode === null) { vault.kill(); await once(vault, 'exit'); }
  await fs.rm(temporary, { recursive: true, force: true });
}
