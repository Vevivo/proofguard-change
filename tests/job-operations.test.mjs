import test from 'node:test';
import assert from 'node:assert/strict';
import { jobOperation } from '../genlayer/job-operations.mjs';
const w = { id: 'WORKFLOW-01' }, job = { id: 'JOB-01', gate: 'READY', intent_hash: 'a'.repeat(64) };
test('operational next steps distinguish review, owner authorization and permitted execution', () => {
  assert.equal(jobOperation(w, { ...job, gate: 'AWAITING_REVIEW' }, 2).tool, null);
  const authorize = jobOperation(w, job, 2); assert.equal(authorize.actor, 'Workflow owner'); assert.equal(authorize.tool, 'proofguard_authorize_job');
  const execute = jobOperation(w, { ...job, active_permit: {} }, 2); assert.equal(execute.group, 'ready'); assert.equal(execute.tool, 'proofguard_execute_approved_job');
  assert.deepEqual(execute.args, { workflowId: w.id, jobId: job.id, expectedRevision: 2, expectedIntentHash: job.intent_hash });
});
test('only current outputs offer delivery; historical and held jobs offer no executable call', () => {
  const execution = { revision: 1, output_sha256: 'b'.repeat(64) };
  assert.equal(jobOperation(w, { ...job, execution }, 1).tool, 'proofguard_deliver_report');
  assert.equal(jobOperation(w, { ...job, execution }, 2).tool, null);
  for (const gate of ['MATERIAL_CHANGE', 'INSUFFICIENT_EVIDENCE']) assert.equal(jobOperation(w, { ...job, gate }, 2).tool, null);
});
