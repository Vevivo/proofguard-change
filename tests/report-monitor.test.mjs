import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createReportVault } from '../services/report-vault.mjs';
import { createInspector, sha256, POLICY } from '../agents/inspector.mjs';

const fixture = JSON.parse(await fs.readFile(new URL('../deployments/studio-next-correction-state.json', import.meta.url), 'utf8'));
const token = 'monitor-test-token-' + 'a'.repeat(32), workflowId = 'DELIVERY-REGRESSION-01';
async function setup(options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proofguard-monitor-'));
  const bundle = structuredClone(fixture);
  const rpc = { request: async () => '0xf22d', getContractCode: async () => 'verified code', readContract: async ({ functionName }) => functionName === 'get_policy' ? POLICY : JSON.stringify(bundle) };
  const inspector = createInspector({ client: rpc, chainId: 61997, contract: '0x' + 'a'.repeat(40), sourceId: bundle.source.id, expectedCodeSha256: sha256('verified code') });
  const input = { workflowId, jobId: 'STANDARD', expectedRevision: 2, expectedOutputSha256: bundle.workflows[0].actions[0].execution.output_sha256 };
  const s = { directory, bundle, rpc, inspector, input, id: null };
  s.start = async () => {
    s.server = createReportVault({ inspector, directory, token, allowedWorkflows: [workflowId], ...options });
    s.server.listen(0, '127.0.0.1'); await once(s.server, 'listening');
    s.endpoint = `http://127.0.0.1:${s.server.address().port}`;
    await s.server.reportMonitor.scan();
  };
  s.request = (suffix, extra = {}) => fetch(`${s.endpoint}/v1/reports${suffix}`, { ...extra, headers: { authorization: `Bearer ${token}`, ...extra.headers } });
  s.import = async () => {
    const response = await s.request('', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    assert([200, 201].includes(response.status));
    const result = await response.json(); s.id = result.id; return result;
  };
  s.status = async () => (await s.request(`/${s.id}/status`)).json();
  s.recheck = async () => (await s.request(`/${s.id}/recheck`, { method: 'POST' })).json();
  s.events = async (query = '') => (await s.request(`/${s.id}/events${query}`)).json();
  s.correct = () => {
    const text = 'Updated source no longer supports the old report.';
    bundle.source.revision = 3; bundle.source.versions.push({ revision: 3, text, sha256: sha256(text) });
    bundle.workflows[0].revision = 3; bundle.workflows[0].actions[1].gate = 'AWAITING_REVIEW';
  };
  s.stop = async () => { if (s.server.listening) await new Promise(resolve => s.server.close(resolve)); };
  s.close = async () => { await s.stop(); await fs.rm(directory, { recursive: true, force: true }); };
  await s.start(); return s;
}

test('a scan invalidates a stored report after correction without any download', async () => {
  const s = await setup();
  try {
    await s.import(); assert.equal((await s.status()).state, 'CURRENT');
    s.correct(); await s.server.reportMonitor.scan();
    const status = await s.status();
    assert.equal(status.state, 'INVALIDATED'); assert.equal(status.reason, 'STALE_SOURCE_REVISION');
    assert.equal(status.validUntil, null);
    assert.deepEqual((await s.events()).events.map(event => event.state), ['CURRENT', 'INVALIDATED']);
    const download = await s.request(`/${s.id}/content`);
    assert.equal(download.status, 409); assert.equal((await download.json()).error, 'STALE_SOURCE_REVISION');
  } finally { await s.close(); }
});

test('periodic checks run automatically and close waits for monitoring to stop', async () => {
  const s = await setup({ monitorIntervalMs: 10 });
  try {
    await s.import(); s.correct();
    const deadline = Date.now() + 2000;
    while ((await s.status()).state !== 'INVALIDATED' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal((await s.status()).state, 'INVALIDATED');
    let calls = 0; const getOutput = s.inspector.getOutput;
    s.inspector.getOutput = (...args) => { calls++; return getOutput(...args); };
    await s.stop(); const closedCalls = calls;
    await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(calls, closedCalls);
  } finally { await s.close(); }
});

test('outage and integrity uncertainty fail closed, recover, and never expose provider secrets', async () => {
  const s = await setup();
  try {
    await s.import(); const request = s.rpc.request;
    s.rpc.request = async () => { throw Error('RPC_CREDENTIAL_TOP_SECRET'); };
    const unavailable = await s.recheck();
    assert.equal(unavailable.state, 'UNVERIFIABLE'); assert.equal(unavailable.reason, 'RPC_READ_FAILED');
    assert.equal(unavailable.validUntil, null);
    assert.equal((await s.request(`/${s.id}/content`)).status, 409);
    assert(!(JSON.stringify(await s.events()).includes('SECRET')));
    s.rpc.request = request; assert.equal((await s.recheck()).state, 'CURRENT');
    s.rpc.getContractCode = async () => 'unrecognized code';
    assert.deepEqual(((status) => [status.state, status.reason])(await s.recheck()), ['UNVERIFIABLE', 'CONTRACT_CODE_MISMATCH']);
  } finally { await s.close(); }
});

test('repeated current checks refresh freshness without duplicate events or duplicate reports', async () => {
  let clock = Date.now(); const s = await setup({ now: () => clock, freshnessMs: 1000 });
  try {
    const first = await s.import(), initial = await s.status(); clock += 100;
    const refreshed = await s.recheck();
    assert(refreshed.checkedAt > initial.checkedAt); assert(refreshed.validUntil > initial.validUntil);
    assert.equal(refreshed.lastEventSequence, 1); assert.equal((await s.events()).events.length, 1);
    const repeat = await s.import(); assert.equal(repeat.id, first.id); assert.equal(repeat.reused, true);
    assert.equal((await s.events()).events.length, 1);
  } finally { await s.close(); }
});

test('status expires a cached observation at its deadline even without a network check', async () => {
  let clock = Date.now(); const s = await setup({ now: () => clock, freshnessMs: 1000 });
  try {
    await s.import(); const initial = await s.status();
    let calls = 0; const getOutput = s.inspector.getOutput;
    s.inspector.getOutput = (...args) => { calls++; return getOutput(...args); };
    clock += 1000; const expired = await s.status();
    assert.equal(expired.state, 'UNVERIFIABLE'); assert.equal(expired.reason, 'CHECK_EXPIRED');
    assert.equal(expired.validUntil, initial.validUntil); assert.equal(expired.lastEventSequence, 2); assert.equal(calls, 0);
    await s.status(); assert.equal((await s.events()).events.length, 2);
    assert.equal((await s.recheck()).state, 'CURRENT'); assert.equal((await s.events()).events.length, 3);
  } finally { await s.close(); }
});

test('restart preserves invalidation, ordered history, and event pagination', async () => {
  const s = await setup();
  try {
    await s.import(); const request = s.rpc.request;
    s.rpc.request = async () => { throw Error('offline'); }; await s.recheck();
    s.rpc.request = request; await s.recheck(); s.correct(); await s.recheck();
    const before = await s.events(); assert.equal(before.events.length, 4);
    await s.stop(); await s.start();
    assert.equal((await s.status()).state, 'INVALIDATED');
    assert.deepEqual(await s.events(), before);
    const first = await s.events('?after=0&limit=2');
    assert.deepEqual(first.events.map(event => event.sequence), [1, 2]); assert.equal(first.nextCursor, 2); assert.equal(first.hasMore, true);
    const second = await s.events('?after=2&limit=2');
    assert.deepEqual(second.events.map(event => event.sequence), [3, 4]); assert.equal(second.nextCursor, 4); assert.equal(second.hasMore, false);
    assert.deepEqual((await s.events('?after=4')).events, []);
  } finally { await s.close(); }
});

test('a slow verification cannot receive a fresh TTL after its observation window elapsed', async () => {
  let clock = Date.now(); const s = await setup({ now: () => clock, freshnessMs: 1000 });
  try {
    await s.import(); clock += 100;
    const startedAt = clock, getOutput = s.inspector.getOutput;
    s.inspector.getOutput = async (...args) => { const output = await getOutput(...args); clock += 1000; return output; };
    const status = await s.recheck();
    assert.equal(status.state, 'UNVERIFIABLE'); assert.equal(status.reason, 'CHECK_EXPIRED');
    assert.equal(status.checkedAt, new Date(startedAt).toISOString());
    assert.equal(status.validUntil, new Date(startedAt + 1000).toISOString());
    assert.equal((await s.request(`/${s.id}/content`)).status, 409);
  } finally { await s.close(); }
});

test('clock rollback expires a cached current observation', async () => {
  let clock = Date.now(); const s = await setup({ now: () => clock, freshnessMs: 1000 });
  try {
    await s.import(); clock -= 1;
    const status = await s.status();
    assert.equal(status.state, 'UNVERIFIABLE'); assert.equal(status.reason, 'CHECK_EXPIRED');
    assert.equal((await s.events()).events.length, 2);
  } finally { await s.close(); }
});

test('a delayed successful admission cannot replace a newer failed recheck', async () => {
  let clock = Date.now(); const s = await setup({ now: () => clock, freshnessMs: 1000 });
  try {
    await s.import(); clock += 100;
    const earlierAdmissionStartedAt = clock;
    clock += 100; s.rpc.request = async () => { throw Error('offline'); };
    const unavailable = await s.recheck(); assert.equal(unavailable.reason, 'RPC_READ_FAILED');
    clock += 100;
    const delayed = await s.server.reportMonitor.admitted(s.id, earlierAdmissionStartedAt);
    assert.deepEqual(delayed, unavailable);
    assert.deepEqual((await s.events()).events.map(event => event.state), ['CURRENT', 'UNVERIFIABLE']);
  } finally { await s.close(); }
});

test('restart expires old current state before a blocked network read completes', async () => {
  let clock = Date.now(); const s = await setup({ now: () => clock, freshnessMs: 1000 });
  let release;
  try {
    await s.import(); await s.stop(); clock += 2000;
    const getOutput = s.inspector.getOutput;
    let entered; const checking = new Promise(resolve => { entered = resolve; });
    s.inspector.getOutput = async (...args) => { entered(); await new Promise(resolve => { release = resolve; }); return getOutput(...args); };
    const starting = s.start(); await checking;
    const durable = JSON.parse(await fs.readFile(path.join(s.directory, '.monitor', `${s.id}.json`), 'utf8'));
    assert.equal(durable.state, 'UNVERIFIABLE'); assert.equal(durable.reason, 'CHECK_EXPIRED');
    release(); release = null; await starting;
    assert.equal((await s.status()).state, 'CURRENT');
    assert.deepEqual((await s.events()).events.map(event => event.reason), ['VERIFIED_CURRENT', 'CHECK_EXPIRED', 'VERIFIED_CURRENT']);
  } finally { release?.(); await s.close(); }
});

test('legacy receipts register on startup and malformed monitor storage is never reset', async () => {
  const s = await setup();
  try {
    await s.import(); await s.stop();
    await fs.rm(path.join(s.directory, '.monitor'), { recursive: true, force: true });
    await s.start(); assert.equal((await s.status()).state, 'CURRENT');
    assert.deepEqual((await s.events()).events.map(event => event.reason), ['NOT_YET_VERIFIED', 'VERIFIED_CURRENT']);
    const file = path.join(s.directory, '.monitor', `${s.id}.json`);
    await fs.writeFile(file, '{"partial":');
    const response = await s.request(`/${s.id}/recheck`, { method: 'POST' });
    assert.equal(response.status, 409); assert.equal((await response.json()).error, 'MONITOR_STATE_INVALID');
    assert.equal(await fs.readFile(file, 'utf8'), '{"partial":');
    assert.equal((await s.request(`/${s.id}/content`)).status, 409);
  } finally { await s.close(); }
});

test('monitor routes enforce authentication, reject origins and strictly validate pagination/body', async () => {
  const s = await setup();
  try {
    await s.import();
    for (const suffix of [`/${s.id}/status`, `/${s.id}/events`, `/${s.id}/recheck`]) {
      const method = suffix.endsWith('recheck') ? 'POST' : 'GET';
      assert.equal((await fetch(`${s.endpoint}/v1/reports${suffix}`, { method })).status, 401);
      assert.equal((await s.request(suffix, { method, headers: { origin: 'https://example.com' } })).status, 403);
    }
    for (const query of ['?after=-1', '?after=1.5', '?after=9007199254740992', '?after=', '?after=01', '?limit=0', '?limit=101', '?after=0&after=1', '?extra=1', '?limit=2&limit=2']) {
      const response = await s.request(`/${s.id}/events${query}`); assert.equal(response.status, 409, query);
      assert.equal((await response.json()).error, 'INVALID_EVENT_QUERY');
    }
    assert.equal((await s.request(`/${s.id}/status?after=0`)).status, 409);
    assert.equal((await s.request(`/${s.id}/recheck`, { method: 'POST', body: '{}' })).status, 409);
    assert.equal((await s.request(`/${'f'.repeat(64)}/status`)).status, 404);
  } finally { await s.close(); }
});

test('overlapping scan and rechecks serialize and cannot revive an invalidated artifact', async () => {
  const s = await setup(); let release;
  try {
    await s.import(); const verified = await s.inspector.getOutput(s.input);
    let calls = 0, active = 0, peak = 0, entered;
    const firstEntered = new Promise(resolve => { entered = resolve; });
    s.inspector.getOutput = async () => {
      const index = ++calls; active++; peak = Math.max(peak, active);
      try {
        if (index === 1) { entered(); await new Promise(resolve => { release = resolve; }); }
        if (index === 2) throw Error('STALE_SOURCE_REVISION');
        return verified;
      } finally { active--; }
    };
    const scan = s.server.reportMonitor.scan(); await firstEntered;
    const second = s.server.reportMonitor.recheck(s.id), third = s.server.reportMonitor.recheck(s.id);
    release(); release = null;
    await Promise.all([scan, second, third]);
    assert.equal(peak, 1); assert.equal(calls, 3);
    assert.equal((await s.status()).state, 'INVALIDATED');
    assert.deepEqual((await s.events()).events.map(event => event.state), ['CURRENT', 'INVALIDATED']);
  } finally { release?.(); await s.close(); }
});

test('receipt and content reads still perform independent checks and storage corruption stays unavailable', async () => {
  const s = await setup();
  try {
    await s.import(); let calls = 0; const getOutput = s.inspector.getOutput;
    s.inspector.getOutput = (...args) => { calls++; return getOutput(...args); };
    assert.equal((await s.request(`/${s.id}`)).status, 200);
    assert.equal((await s.request(`/${s.id}/content`)).status, 200); assert.equal(calls, 2);
    const file = path.join(s.directory, `${s.id}.json`), record = JSON.parse(await fs.readFile(file, 'utf8'));
    record.outputJson = '{}'; await fs.writeFile(file, JSON.stringify(record));
    const status = await s.status();
    assert.equal(status.state, 'UNVERIFIABLE'); assert.equal(status.reason, 'STORED_RECORD_MISMATCH');
    assert.equal((await s.request(`/${s.id}/content`)).status, 409);
  } finally { await s.close(); }
});
