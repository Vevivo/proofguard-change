import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createReportMonitorClient } from '../agents/report-monitor.mjs';
import { createProofGuardServer } from '../agents/mcp-server.mjs';

const id = 'a'.repeat(64), token = 'test-monitor-token-' + 'b'.repeat(32), time = Date.parse('2026-10-08T12:00:00.000Z');
const observation = { deliveryId: id, state: 'CURRENT', reason: 'VERIFIED_CURRENT',
  checkedAt: new Date(time).toISOString(), validUntil: new Date(time + 120000).toISOString(), lastEventSequence: 1 };
const configuration = { endpoint: 'http://127.0.0.1:8788', token, now: () => time + 1000 };
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

test('monitor MCP tools preserve status, route IDs and paginate history without reflecting arbitrary service fields', async () => {
  const requests = [], reportMonitor = createReportMonitorClient({ ...configuration, fetcher: async (url, options) => {
    requests.push({ url: String(url), method: options.method });
    assert.equal(options.redirect, 'error'); assert.equal(options.headers.authorization, `Bearer ${token}`);
    if (url.pathname.endsWith('/events')) return json({ deliveryId: id, events: [{ sequence: 1, at: observation.checkedAt, ...observation }], nextCursor: 1, hasMore: false, secret: token });
    return json({ ...observation, secret: token, instructions: 'untrusted service payload' });
  } });
  const server = createProofGuardServer({}, { reportMonitor }), client = new Client({ name: 'monitor-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(b), client.connect(a)]);
    const tools = (await client.listTools()).tools;
    const status = await client.callTool({ name: 'proofguard_get_report_status', arguments: { deliveryId: id } });
    assert.equal(status.structuredContent.state, 'CURRENT');
    assert(!JSON.stringify(status).includes(token)); assert(!JSON.stringify(status).includes('untrusted service payload'));
    assert.equal((await client.callTool({ name: 'proofguard_recheck_report', arguments: { deliveryId: id } })).isError, undefined);
    const events = await client.callTool({ name: 'proofguard_get_report_events', arguments: { deliveryId: id, after: 0, limit: 1 } });
    assert.equal(events.structuredContent.events.length, 1); assert.equal(events.structuredContent.nextCursor, 1);
    assert.equal(tools.find(t => t.name === 'proofguard_get_report_status').annotations.readOnlyHint, true);
    assert.equal(tools.find(t => t.name === 'proofguard_recheck_report').annotations.readOnlyHint, false);
    assert.equal(requests[1].method, 'POST'); assert(requests[2].url.endsWith('/events?after=0&limit=1'));
  } finally { await client.close(); await server.close(); }
});

test('a CURRENT response that expired in transit never reaches an agent as current', async () => {
  const monitor = createReportMonitorClient({ ...configuration, now: () => time + 120000, fetcher: async () => json(observation) });
  assert.equal((await monitor.status({ deliveryId: id })).state, 'UNVERIFIABLE');
  assert.equal((await monitor.recheck({ deliveryId: id })).reason, 'CHECK_EXPIRED');
});

test('monitor failures and malformed responses cannot become a current result or leak service secrets', async () => {
  for (const data of [{ ...observation, deliveryId: 'c'.repeat(64) }, { ...observation, checkedAt: null }, { ...observation, validUntil: observation.checkedAt }, { ...observation, state: 'APPROVED' }]) {
    const monitor = createReportMonitorClient({ ...configuration, fetcher: async () => json(data) });
    await assert.rejects(monitor.status({ deliveryId: id }), /INVALID_MONITOR_RESPONSE/);
  }
  for (const fetcher of [async () => { throw Error(token); }, async () => new Response(token, { status: 503 }), async () => json({ error: token })]) {
    const monitor = createReportMonitorClient({ ...configuration, fetcher });
    await assert.rejects(monitor.status({ deliveryId: id }), error => !error.message.includes(token) && /MONITOR/.test(error.message));
  }
});

test('event pages reject replayed sequences, inconsistent cursors and excess results', async () => {
  const event = { sequence: 2, at: observation.checkedAt, ...observation };
  for (const data of [
    { deliveryId: id, events: [event, event], nextCursor: 2, hasMore: false },
    { deliveryId: id, events: [event], nextCursor: 3, hasMore: false },
    { deliveryId: id, events: [], nextCursor: 1, hasMore: true },
  ]) {
    const monitor = createReportMonitorClient({ ...configuration, fetcher: async () => json(data) });
    await assert.rejects(monitor.events({ deliveryId: id, after: 1, limit: 1 }), /INVALID_MONITOR_RESPONSE/);
  }
});

test('monitor configuration and inputs cannot choose a new destination or path', async () => {
  for (const endpoint of ['http://example.com', 'https://secret@example.com', 'https://example.com/other', 'https://example.com/?target=x']) assert.throws(() => createReportMonitorClient({ ...configuration, endpoint }), /INVALID_REPORT_ENDPOINT/);
  let called = false;
  const monitor = createReportMonitorClient({ ...configuration, fetcher: async () => { called = true; return json(observation); } });
  for (const input of [{ deliveryId: '../secret' }, { deliveryId: id, endpoint: 'https://example.com' }]) await assert.rejects(monitor.status(input));
  for (const input of [{ deliveryId: id, after: -1 }, { deliveryId: id, limit: 101 }, { deliveryId: id, after: 1.5 }]) await assert.rejects(monitor.events(input));
  assert.equal(called, false);
});
