import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createWorkflowManager, managerInputs } from '../agents/workflow-manager.mjs';
import { createProofGuardServer, configuredServices } from '../agents/mcp-server.mjs';
import { prepareAgentRequest } from '../genlayer/agent-request.mjs';
import { sha256 } from '../agents/inspector.mjs';
import { TransactionExecutionFailed } from '../genlayer/change-transaction.mjs';

const account = '0x' + 'a'.repeat(40), other = '0x' + 'b'.repeat(40), hash = '0x' + 'c'.repeat(64);
function setup() {
  const workspace = { chainId: 61999, contract: '0x' + 'd'.repeat(40), sourceId: 'SOURCE-01' };
  const text = 'Standard plan costs USD 49 per team per month.';
  const source = { id: workspace.sourceId, title: 'Support plan', publisher: account, revision: 1, sha256: sha256(text) };
  const bundle = { source: { approved_owners: [account], versions: [{ revision: 1, text, sha256: sha256(text) }] }, workflows: [] };
  const snapshot = { ...workspace, source, bundle, contractCodeSha256: 'e'.repeat(64) };
  const records = new Map(), writes = [], job = { id: 'price-report', intentHash: 'f'.repeat(64), state: 'AUTHORIZATION_REQUIRED' };
  const inspector = {
    inspectContract: async () => ({ ...workspace, sourceIds: [] }),
    inspectSource: async () => snapshot,
    inspectWorkflow: async () => ({ ...snapshot, workflow: { owner: account, jobs: [job] } }),
  };
  const journal = { read: async k => records.get(k), claim: async (k, v) => { if (records.has(k)) return false; records.set(k, v); return true; }, update: async (k, v) => records.set(k, v) };
  const apply = () => {
    const { functionName: method, args } = writes.at(-1);
    if (method === 'publish_source') { source.title = args[1]; source.sha256 = sha256(args[2]); bundle.source.versions[0] = { revision: 1, text: args[2], sha256: source.sha256 }; }
    if (method === 'revise_source') { source.revision++; source.sha256 = sha256(args[2]); bundle.source.versions.push({ revision: source.revision, text: args[2], sha256: source.sha256 }); }
    if (method === 'approve_workflow_owner') bundle.source.approved_owners.push(args[1]);
    if (method === 'register_workflow') bundle.workflows.push({ id: args[0], title: args[1], owner: account, executor: args[4], baseline_revision: Number(args[3]), reviewed_revision: 0,
      actions: JSON.parse(args[5]).map(j => ({ id: j.id, label: j.label, condition: j.condition, intent_json: JSON.stringify({ tool: j.tool, target: j.target, payload: j.payload }) })) });
    if (method === 'review_source') bundle.workflows.forEach(w => { w.reviewed_revision = source.revision; });
    if (method === 'authorize_action') job.state = 'READY_FOR_CONTRACT_EXECUTION';
  };
  const options = { workspace, account, inspector, journal, capabilities: Object.keys(managerInputs), client: { writeContract: async tx => { writes.push(tx); return hash; } }, finalize: async () => { if (!writes.at(-1)._applied) { apply(); writes.at(-1)._applied = true; } } };
  return { options, source, bundle, snapshot, inspector, writes, records, job, text };
}
const auth = { expectedRevision: 1, workflowId: 'WORKFLOW-01', jobId: 'price-report', expectedIntentHash: 'f'.repeat(64) };

test('MCP manages source, exact workflow, review, authorization and correction with explicit delegated capabilities', async () => {
  const s = setup(), manager = createWorkflowManager(s.options), server = createProofGuardServer(s.inspector, { manager });
  const client = new Client({ name: 'delegated-operator-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(b), client.connect(a)]);
    const listed = (await client.listTools()).tools;
    assert.equal(listed.length, 12); assert.equal(listed.find(t => t.name === 'proofguard_authorize_job').annotations.readOnlyHint, false);
    const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); assert(!r.isError, JSON.stringify(r)); return r.structuredContent; };
    await call('proofguard_publish_source', { title: 'Support plan', text: s.text });
    const request = await call('proofguard_prepare_workflow', { expectedRevision: 1, workflow: { id: 'WORKFLOW-01', title: 'Support report', owner: account, executor: other,
      jobs: [{ id: 'price-report', label: 'Price report', condition: s.text, tool: 'prepare_price_report', target: 'standard-plan', payload: { unit_price: 49, currency: 'USD' } }] } });
    const envelope = JSON.parse(request.requestJson);
    await call('proofguard_register_workflow', { envelope });
    assert.equal((await call('proofguard_register_workflow', { envelope })).state, 'STATE_CONFIRMED');
    // finalize callback must emulate an idempotent transaction read, not reapply.
    assert.equal(s.writes.filter(t => t.functionName === 'register_workflow').length, 1);
    await call('proofguard_review_source', { expectedRevision: 1, workflowIds: ['WORKFLOW-01'] });
    await call('proofguard_authorize_job', auth);
    await call('proofguard_approve_owner', { expectedRevision: 1, owner: other });
    await call('proofguard_revise_source', { expectedRevision: 1, text: 'Standard plan now costs USD 59 per team per month.' });
    assert.equal(s.source.revision, 2);
    assert(s.writes.every(tx => tx.value === 0n));
  } finally { await client.close(); await server.close(); }
});

test('capability restrictions cannot be changed through tool input', async () => {
  const s = setup(); s.options.capabilities = ['review_source'];
  await assert.rejects(createWorkflowManager(s.options).run('authorize_job', auth), /MANAGER_CAPABILITY_DISABLED/);
  const manager = createWorkflowManager(s.options), server = createProofGuardServer(s.inspector, { manager });
  const client = new Client({ name: 'restricted-operator', version: '1' }); const [a, b] = InMemoryTransport.createLinkedPair();
  try { await Promise.all([server.connect(b), client.connect(a)]); assert(!(await client.listTools()).tools.some(t => t.name === 'proofguard_authorize_job')); }
  finally { await client.close(); await server.close(); }
  assert.equal(s.writes.length, 0);
});
test('wrong publisher, stale revision and changed review set stop before wallet submission', async () => {
  const s = setup(), manager = createWorkflowManager(s.options);
  s.source.publisher = other;
  await assert.rejects(manager.run('revise_source', { expectedRevision: 1, text: s.text + ' New price.' }), /ONLY_SOURCE_PUBLISHER/);
  s.source.publisher = account;
  await assert.rejects(manager.run('approve_owner', { expectedRevision: 2, owner: other }), /STALE_SOURCE_REVISION/);
  s.bundle.workflows.push({ id: 'WORKFLOW-01', reviewed_revision: 0 }, { id: 'WORKFLOW-02', reviewed_revision: 0 });
  await assert.rejects(manager.run('review_source', { expectedRevision: 1, workflowIds: ['WORKFLOW-01'] }), /REVIEW_SET_CHANGED/);
  assert.equal(s.writes.length, 0);
});
for (const state of ['REVIEW_REQUIRED', 'CONDITION_CHANGED', 'EVIDENCE_NEEDED']) test(`delegated owner cannot authorize ${state}`, async () => {
  const s = setup(); s.job.state = state;
  await assert.rejects(createWorkflowManager(s.options).run('authorize_job', auth), /JOB_NOT_SUPPORTED/); assert.equal(s.writes.length, 0);
});
test('finalized transaction with a denied state is not reported as authorization', async () => {
  const s = setup(); s.options.finalize = async () => {};
  await assert.rejects(createWorkflowManager(s.options).run('authorize_job', auth), /AUTHORIZATION_NOT_CONFIRMED/);
  assert.equal(s.writes.length, 1);
});
test('manager cannot register for a different owner or accept edited request content', async () => {
  const s = setup(); s.bundle.source.approved_owners.push(other);
  const envelope = await prepareAgentRequest(s.inspector, { expectedRevision: 1, workflow: { id: 'WORKFLOW-01', title: 'Report', owner: other, executor: other,
    jobs: [{ id: 'price-report', label: 'Price report', condition: s.text, tool: 'prepare_price_report', target: 'plan', payload: { unit_price: 49, currency: 'USD' } }] } }, sha256);
  const manager = createWorkflowManager(s.options);
  await assert.rejects(manager.run('register_workflow', { envelope }), /ONLY_WORKFLOW_OWNER/);
  envelope.request.workflow.owner = account;
  await assert.rejects(manager.run('register_workflow', { envelope }), /REQUEST_DIGEST_MISMATCH/);
  assert.equal(s.writes.length, 0);
});
test('ambiguous submit remains blocked across process restart', async () => {
  const s = setup(); s.options.client.writeContract = async tx => { s.writes.push(tx); throw Error('secret'); };
  for (let i = 0; i < 2; i++) await assert.rejects(createWorkflowManager(s.options).run('authorize_job', auth), /SUBMISSION_OUTCOME_UNKNOWN/);
  assert.equal(s.writes.length, 1);
});
test('a pending correction recovers its hash even after the revision advances', async () => {
  const s = setup(); s.options.finalize = async () => { throw Error('still pending'); };
  const input = { expectedRevision: 1, text: s.text + ' Updated terms.' };
  assert.equal((await createWorkflowManager(s.options).run('revise_source', input)).state, 'TRANSACTION_PENDING');
  s.source.revision = 2; s.source.sha256 = sha256(input.text);
  s.options.finalize = async () => {};
  assert.equal((await createWorkflowManager(s.options).run('revise_source', input)).state, 'STATE_CONFIRMED');
  assert.equal(s.writes.length, 1);
});
test('failed manager transaction is never silently resubmitted', async () => {
  const s = setup(); s.options.finalize = async () => { throw new TransactionExecutionFailed(hash, 'ERROR'); };
  for (let i = 0; i < 2; i++) assert.equal((await createWorkflowManager(s.options).run('authorize_job', auth)).state, 'TRANSACTION_FAILED');
  assert.equal(s.writes.length, 1);
});
test('manager refuses extra transaction fields, invalid capability and missing opt-in configuration', async () => {
  const s = setup();
  await assert.rejects(createWorkflowManager(s.options).run('authorize_job', { ...auth, value: 1 }), /INVALID_MANAGER_INPUT/);
  assert.throws(() => createWorkflowManager({ ...s.options, capabilities: ['execute_anything'] }), /INVALID_MANAGER_CAPABILITIES/);
  await assert.rejects(configuredServices(['--network', 'studionet', '--contract', account, '--source', 'SOURCE-01', '--enable-manager'], {}), /MANAGER_CONFIGURATION_REQUIRED/);
});

test('a historical output never confirms a current authorization', async () => {
  const s = setup(); s.job.state = 'OUTPUT_CREATED'; s.job.output = { isCurrentRevision: false };
  await assert.rejects(createWorkflowManager(s.options).run('authorize_job', auth), /HISTORICAL_OUTPUT_REQUIRES_NEW_WORKFLOW/);
  assert.equal(s.writes.length, 0);
  s.job.output.isCurrentRevision = true;
  assert.equal((await createWorkflowManager(s.options).run('authorize_job', auth)).state, 'STATE_CONFIRMED');
});

test('different simultaneous operations cannot race the same manager account', async () => {
  const s = setup(); let release;
  s.options.finalize = () => new Promise(resolve => { release = resolve; });
  const manager = createWorkflowManager(s.options), first = manager.run('authorize_job', auth);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(manager.run('approve_owner', { expectedRevision: 1, owner: other }), /OPERATION_IN_PROGRESS/);
  s.job.state = 'READY_FOR_CONTRACT_EXECUTION'; release();
  assert.equal((await first).state, 'STATE_CONFIRMED'); assert.equal(s.writes.length, 1);
});
