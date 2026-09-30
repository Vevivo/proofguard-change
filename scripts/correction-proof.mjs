import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');

// Checks persisted contract history, not UI labels or a publisher-supplied PASS flag.
export function verifyCorrectionState(bundle, fixture, accounts) {
  assert.equal(bundle.schema, 'proofguard-change/2.0');
  assert.equal(bundle.source.id, fixture.sourceId);
  assert.equal(bundle.source.revision, 2, 'Reference source changed; inspect the newer revision');
  assert.deepEqual(bundle.source.versions.map(v => v.text), [fixture.before, fixture.after]);
  for (const v of bundle.source.versions) assert.equal(sha256(v.text), v.sha256);
  assert.equal(bundle.workflows.length, 1);
  const w = bundle.workflows[0];
  assert.equal(w.id, fixture.workflowId);
  assert.equal(w.owner.toLowerCase(), accounts.owner.toLowerCase());
  assert.equal(w.executor.toLowerCase(), accounts.executor.toLowerCase());
  assert.notEqual(w.owner, w.executor, 'Owner and executor must be separate');
  assert.equal(w.baseline_revision, 1);
  assert.equal(w.reviewed_revision, 2);
  assert.deepEqual(w.reviews.map(r => r.revision), [1, 2]);
  for (const r of w.reviews) {
    assert.equal(r.policy, 'proofguard-change/2.0');
    assert.equal(r.source_sha256, bundle.source.versions[r.revision - 1].sha256);
    for (const a of r.actions) {
      assert.equal(a.workflow_id, w.id);
      assert(a.old_quote && fixture.before.includes(a.old_quote), 'Baseline citation must come from the source');
      assert(a.new_quote && bundle.source.versions[r.revision - 1].text.includes(a.new_quote), 'Current citation must come from the source');
    }
  }
  const standard = w.actions.find(a => a.id === 'STANDARD');
  const express = w.actions.find(a => a.id === 'EXPRESS');
  assert(standard && express && w.actions.length === 2);
  for (const a of w.actions) {
    assert.equal(sha256(a.intent_json), a.intent_hash);
    const expected = fixture.jobs.find(j => j.id === a.id);
    assert.equal(a.condition, expected.condition);
    assert.deepEqual(JSON.parse(a.intent_json), { tool: expected.tool, target: expected.target, payload: expected.payload });
    for (const p of a.permits) { assert.equal(p.intent_hash, a.intent_hash); assert.equal(p.source_sha256, bundle.source.versions[p.revision - 1].sha256); }
    assert.equal(w.reviews[0].actions.find(r => r.id === a.id).verdict, 'NO_MATERIAL_CHANGE');
  }
  assert.equal(w.reviews[1].actions.find(r => r.id === 'STANDARD').verdict, 'NO_MATERIAL_CHANGE');
  assert.equal(w.reviews[1].actions.find(r => r.id === 'EXPRESS').verdict, 'MATERIAL_CHANGE');
  assert.deepEqual(standard.permits.map(p => p.revision), [1, 2]);
  assert.deepEqual(express.permits.map(p => p.revision), [1]);
  assert.equal(express.execution, null);
  assert.equal(express.gate, 'MATERIAL_CHANGE');
  assert.equal(standard.gate, 'ALREADY_EXECUTED');
  assert.deepEqual(w.attempts.map(a => [a.operation, a.action_id, a.requested_revision, a.current_revision, a.code, a.allowed]), [
    ['AUTHORIZE', 'STANDARD', 1, 1, 'READY', true],
    ['AUTHORIZE', 'EXPRESS', 1, 1, 'READY', true],
    ['EXECUTE', 'STANDARD', 1, 2, 'STALE_SOURCE_REVISION', false],
    ['EXECUTE', 'EXPRESS', 1, 2, 'STALE_SOURCE_REVISION', false],
    ['AUTHORIZE', 'EXPRESS', 2, 2, 'MATERIAL_CHANGE', false],
    ['EXECUTE', 'STANDARD', 2, 2, 'AUTHORIZATION_REQUIRED', false],
    ['AUTHORIZE', 'STANDARD', 2, 2, 'READY', true],
    ['EXECUTE', 'STANDARD', 2, 2, 'READY', true],
    ['EXECUTE', 'STANDARD', 2, 2, 'ALREADY_EXECUTED', false],
  ]);
  for (const a of w.attempts) assert.equal(a.actor.toLowerCase(), (a.operation === 'AUTHORIZE' ? accounts.owner : accounts.executor).toLowerCase());
  const e = standard.execution;
  assert(e, 'The supported job did not produce an output');
  assert.equal(e.revision, 2); assert.equal(e.intent_hash, standard.intent_hash);
  assert.equal(e.permit_id, standard.permits[1].id);
  assert.equal(e.executor.toLowerCase(), accounts.executor.toLowerCase());
  assert.equal(sha256(e.output_json), e.output_sha256);
  const output = JSON.parse(e.output_json);
  assert.equal(output.kind, 'PURCHASE_ORDER_DRAFT');
  assert.equal(output.source_revision, 2); assert.equal(output.total, 480);
  assert.equal(output.shipping, 'standard'); assert.equal(output.permit_id, e.permit_id);
  assert.equal(e.external_order, 'NOT_SUBMITTED'); assert.equal(e.external_payment, 'NOT_SUBMITTED');
  return { oldPermitsBlocked: 2, unsupportedJobsHeld: 1, freshPermitRequired: true, outputsCreated: 1, replayBlocked: true, outputSha256: e.output_sha256 };
}
