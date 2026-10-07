import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createInspector, sha256, POLICY } from '../agents/inspector.mjs';
import { createProofGuardServer, configuredInspector } from '../agents/mcp-server.mjs';

const fixture = JSON.parse(await fs.readFile(new URL('../deployments/studio-next-correction-state.json', import.meta.url), 'utf8'));
const workflowId = 'DELIVERY-REGRESSION-01';
function setup() {
  const bundle = structuredClone(fixture), reads = [];
  const client = {
    request: async () => '0xf22d', getContractCode: async () => 'pinned source',
    readContract: async call => { reads.push(call); return call.functionName === 'get_policy' ? POLICY : JSON.stringify(bundle); },
    writeContract: () => { throw Error('NO_WRITE_METHOD_MAY_BE_USED'); },
  };
  const args = { client, chainId: 61997, contract: '0x' + 'a'.repeat(40), sourceId: bundle.source.id, expectedCodeSha256: sha256('pinned source') };
  return { bundle, client, args, reads, inspector: createInspector(args) };
}
test('inspects actual archived shape with a mocked RPC and retrieves bound output', async () => {
  const s = setup();
  const r = await s.inspector.inspectWorkflow({ workflowId, expectedRevision: 2 });
  assert.deepEqual(r.workflow.jobs.map(j => j.state), ['OUTPUT_CREATED', 'CONDITION_CHANGED']);
  const output = await s.inspector.getOutput({ workflowId, jobId: 'STANDARD' });
  assert.equal(sha256(output.outputJson), output.sha256);
  assert.equal(output.isCurrentRevision, true);
  assert.equal(output.output.kind, 'PURCHASE_ORDER_DRAFT');
  assert(s.reads.every(r => r.transactionHashVariant === 'latest-final'));
});
for (const [label, mutate, error] of [
  ['chain', s => { s.client.request = async () => '0xf22f'; }, 'CHAIN_MISMATCH'],
  ['code', s => { s.client.getContractCode = async () => 'changed'; }, 'CONTRACT_CODE_MISMATCH'],
  ['policy', s => { s.client.readContract = async () => 'wrong'; }, 'POLICY_MISMATCH'],
  ['source text', s => { s.bundle.source.versions[0].text += 'edited'; }, 'SOURCE_DIGEST_MISMATCH'],
  ['intent', s => { s.bundle.workflows[0].actions[0].intent_json = '{}'; }, 'INTENT_DIGEST_MISMATCH'],
  ['source relationship', s => { s.bundle.workflows[0].source_id = 'other'; }, 'WORKFLOW_SOURCE_MISMATCH'],
  ['unknown gate', s => { s.bundle.workflows[0].actions[1].gate = 'APPROVED'; }, 'UNKNOWN_GATE'],
  ['duplicate workflow', s => { s.bundle.workflows.push(s.bundle.workflows[0]); }, 'WORKFLOW_SET_MISMATCH'],
  ['outage', s => { s.client.request = async () => { throw Error('https://secret@rpc'); }; }, 'RPC_READ_FAILED'],
]) test(`rejects ${label} mismatch instead of reporting a usable state`, async () => {
  const s = setup(); mutate(s);
  await assert.rejects(s.inspector.listWorkflows(), new RegExp(error));
});
test('a fresh read detects revision changes; no stale cache fallback', async () => {
  const s = setup();
  await s.inspector.inspectWorkflow({ workflowId, expectedRevision: 2 });
  const text = 'New revision registered after the previous inspection.';
  s.bundle.source.revision = 3;
  s.bundle.source.versions.push({ revision: 3, text, sha256: sha256(text) });
  const w = s.bundle.workflows[0]; w.revision = 3; w.actions[1].gate = 'AWAITING_REVIEW';
  await assert.rejects(s.inspector.inspectWorkflow({ workflowId, expectedRevision: 2 }), /STALE_SOURCE_REVISION/);
  const output = await s.inspector.getOutput({ workflowId, jobId: 'STANDARD' });
  assert.equal(output.isCurrentRevision, false);
  assert.equal(output.outputRevision, 2);
  assert.equal(output.source.revision, 3);
});
test('lowercase contract links use EIP-55 in both code and state RPC reads', async () => {
  const s = setup(), expected = '0x91883d4829E5b5bD7BED6eBd0EceF927A71942d6';
  s.client.getContractCode = async address => { assert.equal(address, expected); return 'pinned source'; };
  const inspector = createInspector({ ...s.args, contract: expected.toLowerCase() });
  await inspector.listWorkflows();
  assert(s.reads.every(call => call.address === expected));
});
test('READY without an active permit requires owner authorization', async () => {
  const s = setup(), a = s.bundle.workflows[0].actions[0];
  a.execution = null; a.gate = 'READY';
  const r = await s.inspector.inspectWorkflow({ workflowId });
  assert.equal(r.workflow.jobs[0].state, 'AUTHORIZATION_REQUIRED');
  a.active_permit = a.permits.at(-1);
  const r2 = await s.inspector.inspectWorkflow({ workflowId });
  assert.equal(r2.workflow.jobs[0].state, 'READY_FOR_CONTRACT_EXECUTION');
  a.active_permit.source_sha256 = 'f'.repeat(64);
  await assert.rejects(s.inspector.inspectWorkflow({ workflowId }), /PERMIT_BINDING_MISMATCH/);
});
test('output checks digest and bindings, not just presence', async () => {
  const s = setup(), e = s.bundle.workflows[0].actions[0].execution;
  e.output_json += ' ';
  await assert.rejects(s.inspector.getOutput({ workflowId, jobId: 'STANDARD' }), /OUTPUT_DIGEST_MISMATCH/);
  const forged = JSON.parse(e.output_json); forged.target = 'other-destination';
  e.output_json = JSON.stringify(forged); e.output_sha256 = sha256(e.output_json);
  await assert.rejects(s.inspector.getOutput({ workflowId, jobId: 'STANDARD' }), /OUTPUT_BINDING_MISMATCH/);
});
test('a held job has no output, and unknown workflows cannot be guessed', async () => {
  const s = setup();
  await assert.rejects(s.inspector.getOutput({ workflowId, jobId: 'EXPRESS' }), /OUTPUT_NOT_CREATED/);
  await assert.rejects(s.inspector.inspectWorkflow({ workflowId: 'UNKNOWN' }), /WORKFLOW_NOT_FOUND/);
});
test('bounded timeout produces no successful observation', async () => {
  const s = setup(); s.client.request = () => new Promise(() => {});
  await assert.rejects(createInspector({ ...s.args, timeoutMs: 10 }).listWorkflows(), /READ_TIMEOUT/);
});
test('MCP discovery, tools/call, structured responses and fail-closed errors', async () => {
  const s = setup(), server = createProofGuardServer(s.inspector);
  const client = new Client({ name: 'test-consumer', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 6);
    assert(listed.tools.every(t => t.annotations.readOnlyHint));
    const result = await client.callTool({ name: 'proofguard_inspect_workflow', arguments: { workflowId } });
    assert.equal(result.structuredContent.workflow.jobs[1].state, 'CONDITION_CHANGED');
    const held = await client.callTool({ name: 'proofguard_get_output', arguments: { workflowId, jobId: 'EXPRESS' } });
    assert.equal(held.isError, true);
    assert.equal(held.structuredContent.error, 'OUTPUT_NOT_CREATED');
    assert.equal(held.structuredContent.state, 'UNKNOWN');
    s.client.request = async () => { throw Error('secret wallet or RPC payload'); };
    const failure = await client.callTool({ name: 'proofguard_list_workflows', arguments: {} });
    assert.equal(failure.isError, true);
    assert(!JSON.stringify(failure).includes('secret'));
  } finally { await client.close(); await server.close(); }
});
test('configuration rejects unbound source, unknown network and arbitrary flags', async () => {
  const s = setup();
  assert.throws(() => createInspector({ ...s.args, sourceId: undefined }), /INVALID_CONFIGURATION/);
  await assert.rejects(configuredInspector(['--network', 'mainnet']), /INVALID_NETWORK/);
  await assert.rejects(configuredInspector(['--rpc', 'https://unexpected.example']), /INVALID_CONFIGURATION/);
});
