import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createReportVault } from '../services/report-vault.mjs';
import { createReportDelivery } from '../agents/report-delivery.mjs';
import { createProofGuardServer } from '../agents/mcp-server.mjs';
import { createInspector, sha256, POLICY } from '../agents/inspector.mjs';

const fixture = JSON.parse(await fs.readFile(new URL('../deployments/studio-next-correction-state.json', import.meta.url), 'utf8'));
const token = 'test-service-token-' + 'a'.repeat(32), workflowId = 'DELIVERY-REGRESSION-01';
async function setup() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proofguard-vault-')), bundle = structuredClone(fixture);
  const rpc = { request: async () => '0xf22d', getContractCode: async () => 'verified code', readContract: async ({ functionName }) => functionName === 'get_policy' ? POLICY : JSON.stringify(bundle) };
  const inspector = createInspector({ client: rpc, chainId: 61997, contract: '0x' + 'a'.repeat(40), sourceId: bundle.source.id, expectedCodeSha256: sha256('verified code') });
  const server = createReportVault({ inspector, directory, token, allowedWorkflows: [workflowId] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const input = { workflowId, jobId: 'STANDARD', expectedRevision: 2, expectedOutputSha256: bundle.workflows[0].actions[0].execution.output_sha256 };
  const send = async (body = input, extra = {}) => fetch(`${endpoint}/v1/reports`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), ...extra });
  return { directory, bundle, rpc, server, endpoint, input, send, inspector, close: async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); } };
}
test('real MCP call stores verified bytes through HTTP and deduplicates concurrent delivery', async () => {
  const s = await setup(), mcp = createProofGuardServer(s.inspector, { deliver: createReportDelivery({ endpoint: s.endpoint, token }) });
  const client = new Client({ name: 'report-consumer', version: '1' }), [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([mcp.connect(b), client.connect(a)]);
    const results = await Promise.all([1, 2].map(() => client.callTool({ name: 'proofguard_deliver_report', arguments: s.input })));
    assert(results.every(r => !r.isError && r.structuredContent.state === 'REPORT_STORED'));
    const id = results[0].structuredContent.deliveryId;
    assert.equal(results[1].structuredContent.deliveryId, id);
    assert.equal((await fs.readdir(s.directory)).length, 1);
    const downloaded = await fetch(`${s.endpoint}/v1/reports/${id}/content`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(downloaded.status, 200); assert.equal(sha256(await downloaded.text()), s.input.expectedOutputSha256);
    assert.equal((await client.listTools()).tools.find(t => t.name === 'proofguard_deliver_report').annotations.readOnlyHint, false);
  } finally { await client.close(); await mcp.close(); await s.close(); }
});
test('service enforces policy on direct HTTP requests without relying on MCP', async () => {
  const s = await setup();
  try {
    assert.equal((await s.send(s.input, { headers: { 'content-type': 'application/json' } })).status, 401);
    for (const [change, expected] of [
      [{ workflowId: 'UNAPPROVED-WORKFLOW' }, 'WORKFLOW_NOT_ALLOWED'],
      [{ jobId: 'EXPRESS' }, 'OUTPUT_NOT_CREATED'],
      [{ expectedRevision: 1 }, 'STALE_SOURCE_REVISION'],
      [{ expectedOutputSha256: 'f'.repeat(64) }, 'OUTPUT_DIGEST_MISMATCH'],
      [{ outputJson: '{"approved":true}' }, 'INVALID_DELIVERY_INPUT'],
      [{ url: 'http://private-service/' }, 'INVALID_DELIVERY_INPUT'],
    ]) {
      const response = await s.send({ ...s.input, ...change }); assert.equal(response.status, 409);
      assert.equal((await response.json()).error, expected);
    }
    assert.equal((await fs.readdir(s.directory)).length, 0);
  } finally { await s.close(); }
});
test('a source correction blocks both new imports and downloads of a previously accepted report', async () => {
  const s = await setup();
  try {
    const admitted = await (await s.send()).json(); assert.equal(admitted.state, 'REPORT_STORED');
    const text = 'Updated evidence removes the previous delivery commitment.';
    s.bundle.source.revision = 3; s.bundle.source.versions.push({ revision: 3, text, sha256: sha256(text) });
    s.bundle.workflows[0].revision = 3; s.bundle.workflows[0].actions[1].gate = 'AWAITING_REVIEW';
    assert.equal((await s.send()).status, 409);
    const newer = await s.send({ ...s.input, expectedRevision: 3 });
    assert.equal((await newer.json()).error, 'HISTORICAL_OUTPUT_BLOCKED');
    const download = await fetch(`${s.endpoint}${admitted.contentPath}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(download.status, 409); assert.equal((await download.json()).error, 'STALE_SOURCE_REVISION');
  } finally { await s.close(); }
});
test('chain failure and changed contract code fail closed even for stored reports', async () => {
  const s = await setup();
  try {
    const saved = await (await s.send()).json();
    s.rpc.getContractCode = async () => 'other code';
    const download = await fetch(`${s.endpoint}${saved.contentPath}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal((await download.json()).error, 'CONTRACT_CODE_MISMATCH');
    s.rpc.request = async () => { throw Error('internal RPC credential'); };
    const failure = await s.send(); const content = await failure.text();
    assert.equal(failure.status, 409); assert(!content.includes('credential'));
  } finally { await s.close(); }
});
test('restart retains receipts; storage tampering does not become a new verified output', async () => {
  const s = await setup();
  try {
    const first = await (await s.send()).json();
    await new Promise(resolve => s.server.close(resolve));
    s.server = createReportVault({ inspector: s.inspector, directory: s.directory, token, allowedWorkflows: [workflowId] });
    s.server.listen(0, '127.0.0.1'); await once(s.server, 'listening');
    const next = `http://127.0.0.1:${s.server.address().port}/v1/reports`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const repeated = await fetch(next, { method: 'POST', headers, body: JSON.stringify(s.input) });
    const repeatedBody = await repeated.json(); assert.equal(repeatedBody.id, first.id); assert.equal(repeatedBody.reused, true);
    const filename = path.join(s.directory, `${first.id}.json`), record = JSON.parse(await fs.readFile(filename));
    record.outputJson = '{}'; await fs.writeFile(filename, JSON.stringify(record));
    const corrupted = await fetch(`${next}/${first.id}/content`, { headers });
    assert.equal((await corrupted.json()).error, 'STORED_RECORD_MISMATCH');
    await new Promise(resolve => s.server.close(resolve));
  } finally { await s.close(); }
});
test('vault requires a token and allowlist; adapter cannot follow redirects or accept remote plain HTTP', async () => {
  assert.throws(() => createReportVault({ token: '', directory: '/tmp/unused', allowedWorkflows: [workflowId] }), /TOKEN/);
  assert.throws(() => createReportVault({ token, directory: '/tmp/unused', allowedWorkflows: [] }), /ALLOWLIST/);
  for (const endpoint of ['http://example.com', 'https://secret@example.com', 'https://example.com/other', 'https://example.com/?target=x']) assert.throws(() => createReportDelivery({ endpoint, token }), /INVALID_REPORT_ENDPOINT/);
  const deliver = createReportDelivery({ endpoint: 'https://example.com', token, fetcher: async (_url, options) => { assert.equal(options.redirect, 'error'); throw Error('secret token'); } });
  const result = await deliver({ workflowId, jobId: 'STANDARD', expectedRevision: 2, expectedOutputSha256: 'a'.repeat(64) });
  assert.equal(result.state, 'DELIVERY_UNCONFIRMED'); assert(!JSON.stringify(result).includes(token));
});
