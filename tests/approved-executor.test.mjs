import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApprovedExecutor, fileExecutionJournal } from '../agents/approved-executor.mjs';
import { TransactionExecutionFailed } from '../genlayer/change-transaction.mjs';
import { configuredServices, createProofGuardServer } from '../agents/mcp-server.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
const hash = `0x${'1'.repeat(64)}`, intent = 'a'.repeat(64), account = `0x${'a'.repeat(40)}`;
function setup() {
  const records = new Map(), writes = [];
  const current = { chainId: 61999, contract: `0x${'b'.repeat(40)}`, source: { id: 'TEST-SOURCE', revision: 1 },
    workflow: { executor: account, jobs: [{ id: 'job-01', state: 'READY_FOR_CONTRACT_EXECUTION', intentHash: intent }] } };
  const output = { outputJson: '{"kind":"PRICE_REPORT"}', sha256: 'test-digest' };
  const inspector = { inspectWorkflow: async ({ expectedRevision }) => { if (expectedRevision !== current.source.revision) throw Error('STALE_SOURCE_REVISION'); return current; }, getOutput: async () => { assert.equal(current.workflow.jobs[0].state, 'OUTPUT_CREATED'); return output; } };
  const client = { writeContract: async args => { writes.push(args); return hash; } };
  const journal = { read: async k => records.get(k), claim: async (k, v) => { if (records.has(k)) return false; records.set(k, v); return true; }, update: async (k, v) => records.set(k, v) };
  const options = { inspector, client, account, journal, finalize: async () => { current.workflow.jobs[0].state = 'OUTPUT_CREATED'; } };
  const args = { workflowId: 'workflow-01', jobId: 'job-01', expectedRevision: 1, expectedIntentHash: intent };
  return { options, args, current, output, writes, records };
}
test('execution consumes only an existing permit and repeat calls return the bound output', async () => {
  const s = setup(), execute = createApprovedExecutor(s.options);
  const first = await execute(s.args), second = await execute(s.args);
  assert.equal(first.state, 'OUTPUT_CREATED'); assert.equal(second.reused, true); assert.equal(s.writes.length, 1);
  assert.deepEqual(s.writes[0], { address: s.current.contract, functionName: 'execute_action', args: ['workflow-01', 'job-01', 1n, intent], value: 0n });
});
for (const state of ['AUTHORIZATION_REQUIRED', 'REVIEW_REQUIRED', 'CONDITION_CHANGED', 'EVIDENCE_NEEDED']) test(`never submits for ${state}`, async () => {
  const s = setup(); s.current.workflow.jobs[0].state = state;
  await assert.rejects(createApprovedExecutor(s.options)(s.args), new RegExp(state)); assert.equal(s.writes.length, 0);
});
test('wrong executor, stale revision and intent mismatch stop before submission', async () => {
  const s = setup(), execute = createApprovedExecutor(s.options);
  await assert.rejects(execute({ ...s.args, expectedRevision: 2 }), /STALE_SOURCE_REVISION/);
  await assert.rejects(execute({ ...s.args, expectedIntentHash: 'c'.repeat(64) }), /INTENT_MISMATCH/);
  s.current.workflow.executor = `0x${'c'.repeat(40)}`;
  await assert.rejects(execute(s.args), /EXECUTOR_MISMATCH/); assert.equal(s.writes.length, 0);
});
test('timeout and process restart recover the stored hash without a second write', async () => {
  const s = setup(); s.options.finalize = async () => { throw Error('RPC unavailable'); };
  assert.equal((await createApprovedExecutor(s.options)(s.args)).state, 'EXECUTION_PENDING');
  s.options.finalize = async h => { assert.equal(h, hash); s.current.workflow.jobs[0].state = 'OUTPUT_CREATED'; };
  assert.equal((await createApprovedExecutor(s.options)(s.args)).state, 'OUTPUT_CREATED'); assert.equal(s.writes.length, 1);
});
test('an ambiguous submit error stays unresolved even after restarting', async () => {
  const s = setup(); s.options.client.writeContract = async args => { s.writes.push(args); throw Error('secret RPC payload'); };
  await assert.rejects(createApprovedExecutor(s.options)(s.args), /SUBMISSION_OUTCOME_UNKNOWN/);
  await assert.rejects(createApprovedExecutor(s.options)(s.args), /SUBMISSION_OUTCOME_UNKNOWN/);
  assert.equal(s.writes.length, 1);
});
test('a reverted transaction cannot be presented as output or silently resubmitted', async () => {
  const s = setup(); s.options.finalize = async () => { throw new TransactionExecutionFailed(hash, 'FINISHED_WITH_ERROR'); };
  for (let i = 0; i < 2; i++) assert.equal((await createApprovedExecutor(s.options)(s.args)).state, 'EXECUTION_FAILED');
  assert.equal(s.writes.length, 1);
});
test('overlapping execution calls are blocked while the first one is running', async () => {
  const s = setup(); let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  s.options.finalize = async () => { entered(); await new Promise(resolve => { release = resolve; }); s.current.workflow.jobs[0].state = 'OUTPUT_CREATED'; };
  const execute = createApprovedExecutor(s.options), first = execute(s.args); await waiting;
  await assert.rejects(execute(s.args), /EXECUTION_IN_PROGRESS/); release(); await first; assert.equal(s.writes.length, 1);
});
test('the on-disk claim survives a new journal instance and refuses a second claimant', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'proofguard-journal-'));
  try {
    const one = fileExecutionJournal(dir), two = fileExecutionJournal(dir), key = 'b'.repeat(64);
    assert.equal(await one.claim(key, { state: 'SUBMITTING' }), true);
    assert.equal(await two.claim(key, { state: 'SUBMITTING' }), false);
    await one.update(key, { state: 'SUBMITTED', hash });
    assert.equal((await two.read(key)).hash, hash);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('executor opt-in needs a supported network and local configuration', async () => {
  const args = ['--network', 'studionet', '--contract', account, '--source', 'TEST-SOURCE', '--enable-executor'];
  await assert.rejects(configuredServices(args, {}), /EXECUTOR_CONFIGURATION_REQUIRED/);
  await assert.rejects(configuredServices(args.map(x => x === 'studionet' ? 'studio-next' : x), {}), /EXECUTION_REQUIRES_STUDIONET/);
});
test('MCP explicitly marks optional execution as a write and redacts unexpected errors', async () => {
  const s = setup(), server = createProofGuardServer(s.options.inspector, { execute: async () => { throw Error('SECRET-KEY in raw provider error'); } });
  const client = new Client({ name: 'executor-test', version: '1' }), [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(b), client.connect(a)]);
    const { tools } = await client.listTools();
    assert.equal(tools.find(t => t.name === 'proofguard_execute_approved_job').annotations.readOnlyHint, false);
    const result = await client.callTool({ name: 'proofguard_execute_approved_job', arguments: s.args });
    assert.equal(result.isError, true); assert(!JSON.stringify(result).includes('SECRET-KEY'));
  } finally { await client.close(); await server.close(); }
});
