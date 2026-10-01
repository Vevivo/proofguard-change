import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { sha256 } from '../agents/inspector.mjs';
import { prepareAgentRequest, parseAgentRequest, assessAgentRequest, agentRequestStatus, requestRegistration, canonical } from '../genlayer/agent-request.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createProofGuardServer } from '../agents/mcp-server.mjs';

const fixture = JSON.parse(await fs.readFile(new URL('../deployments/studio-next-correction-state.json', import.meta.url), 'utf8'));
function setup() {
  const b = structuredClone(fixture);
  const snapshot = { chainId: 61999, contract: `0x${'a'.repeat(40)}`, contractCodeSha256: sha256('code'),
    source: { id: b.source.id, revision: 2, sha256: b.source.versions[1].sha256 }, observedAt: new Date().toISOString(), bundle: b };
  const input = { expectedRevision: 2, workflow: { id: 'AGENT-PLAN-01', title: 'Delivery condition checks', owner: b.source.publisher, executor: b.workflows[0].executor,
    jobs: [{ id: 'price-report', label: 'Price report', condition: 'The source establishes a unit price of EUR 240.', tool: 'prepare_price_report', target: 'controlled-test-supplier', payload: { unit_price: 240, currency: 'EUR' } }] } };
  const inspector = { inspectSource: async () => snapshot, inspectWorkflow: async () => ({ workflow: { jobs: [{ id: 'price-report', state: 'AUTHORIZATION_REQUIRED' }] } }) };
  return { snapshot, input, inspector };
}
test('portable request binds exact jobs to a freshly read revision and owner', async () => {
  const s = setup(), envelope = await prepareAgentRequest(s.inspector, s.input, sha256);
  assert.deepEqual(await parseAgentRequest(JSON.stringify(envelope), sha256), envelope);
  assert.equal(assessAgentRequest(envelope, s.snapshot), 'AWAITING_OWNER_REGISTRATION');
  const args = requestRegistration(envelope);
  assert.deepEqual(args.slice(0, 5), [s.input.workflow.id, s.input.workflow.title, s.snapshot.source.id, 2n, s.input.workflow.executor]);
  assert.deepEqual(JSON.parse(args[5]), s.input.workflow.jobs);
  assert.equal((await agentRequestStatus(s.inspector, envelope, sha256)).state, 'AWAITING_OWNER_REGISTRATION');
});
test('tampered, malformed, oversized and extra-field requests fail before a network read', async () => {
  const s = setup(), envelope = await prepareAgentRequest(s.inspector, s.input, sha256);
  envelope.request.workflow.jobs[0].payload.unit_price = 1;
  await assert.rejects(parseAgentRequest(JSON.stringify(envelope), sha256), /REQUEST_DIGEST_MISMATCH/);
  for (const value of ['{bad', ' '.repeat(16001), JSON.stringify({ ...envelope, endpoint: 'https://evil.example' })]) {
    await assert.rejects(parseAgentRequest(value, sha256), /INVALID_AGENT_REQUEST/);
  }
});
for (const [label, change, expected] of [
  ['wrong network', s => { s.snapshot.chainId = 61997; }, 'REQUESTS_REQUIRE_STUDIONET'],
  ['old revision', s => { s.input.expectedRevision = 1; }, 'STALE_SOURCE_REVISION'],
  ['unapproved owner', s => { s.input.workflow.owner = `0x${'b'.repeat(40)}`; }, 'SOURCE_OWNER_APPROVAL_REQUIRED'],
  ['unsupported tool', s => { s.input.workflow.jobs[0].tool = 'send_payment'; }, 'INVALID_AGENT_REQUEST'],
  ['hidden payload fields', s => { s.input.workflow.jobs[0].payload.endpoint = 'https://evil.example'; }, 'INVALID_AGENT_REQUEST'],
  ['duplicate jobs', s => { s.input.workflow.jobs.push(s.input.workflow.jobs[0]); }, 'INVALID_AGENT_REQUEST'],
  ['UTF-8 byte limit', s => { s.input.workflow.jobs[0].condition = '界'.repeat(500); }, 'INVALID_AGENT_REQUEST'],
  ['zero executor', s => { s.input.workflow.executor = `0x${'0'.repeat(40)}`; }, 'INVALID_AGENT_REQUEST'],
]) test(`preparation rejects ${label}`, async () => {
  const s = setup(); change(s); await assert.rejects(prepareAgentRequest(s.inspector, s.input, sha256), new RegExp(expected));
});
test('a changed source or different workspace invalidates the human handoff', async () => {
  const s = setup(), envelope = await prepareAgentRequest(s.inspector, s.input, sha256);
  s.snapshot.source.revision = 3;
  await assert.rejects(agentRequestStatus(s.inspector, envelope, sha256), /STALE_SOURCE_REVISION/);
  s.snapshot.source.revision = 2; s.snapshot.contractCodeSha256 = sha256('other code');
  assert.throws(() => assessAgentRequest(envelope, s.snapshot), /REQUEST_WORKSPACE_MISMATCH/);
});
test('registration recognition requires exact owner, executor, conditions and parameters', async () => {
  const s = setup(), envelope = await prepareAgentRequest(s.inspector, s.input, sha256), w = s.input.workflow;
  const registered = { ...w, baseline_revision: 2, actions: w.jobs.map(({ id, label, condition, ...intent }) => ({ id, label, condition, intent_json: canonical(intent) })) };
  s.snapshot.bundle.workflows.push(registered);
  assert.equal((await agentRequestStatus(s.inspector, envelope, sha256)).jobs[0].state, 'AUTHORIZATION_REQUIRED');
  registered.executor = `0x${'c'.repeat(40)}`;
  assert.throws(() => assessAgentRequest(envelope, s.snapshot), /WORKFLOW_REQUEST_CONFLICT/);
});
test('MCP prepare and status use the same envelope; execution is absent by default', async () => {
  const s = setup(), server = createProofGuardServer(s.inspector), client = new Client({ name: 'request-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(b), client.connect(a)]);
    const { tools } = await client.listTools();
    assert(!tools.some(t => t.name === 'proofguard_execute_approved_job'));
    const prepared = await client.callTool({ name: 'proofguard_prepare_workflow', arguments: s.input });
    assert(!prepared.isError);
    const data = prepared.structuredContent;
    assert.equal(Buffer.from(new URL(data.approvalUrl).hash.slice(9), 'base64url').toString(), data.requestJson);
    const status = await client.callTool({ name: 'proofguard_get_request_status', arguments: { envelope: JSON.parse(data.requestJson) } });
    assert.equal(status.structuredContent.state, 'AWAITING_OWNER_REGISTRATION');
  } finally { await client.close(); await server.close(); }
});
