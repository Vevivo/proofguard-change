import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyCorrectionState } from '../scripts/correction-proof.mjs';

const load = p => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const state = load('../deployments/studio-next-correction-state.json');
const fixture = load('../examples/correction-scenario.json');
const reference = load('../deployments/studio-next-correction.json');
const verify = b => verifyCorrectionState(b, fixture, reference.accounts);

test('recorded correction evidence establishes two blocked old permits and one output', () => {
  const result = verify(state);
  assert.equal(result.oldPermitsBlocked, 2); assert.equal(result.outputsCreated, 1); assert.equal(result.replayBlocked, true);
});
test('an apparently successful stale attempt cannot pass evidence verification', () => {
  const b = structuredClone(state); b.workflows[0].attempts[2].allowed = true;
  assert.throws(() => verify(b));
});
test('a reused old permit cannot masquerade as a fresh output authorization', () => {
  const b = structuredClone(state); const job = b.workflows[0].actions.find(a => a.id === 'STANDARD');
  job.execution.permit_id = job.permits[0].id;
  assert.throws(() => verify(b));
});
test('changing the registered evidence invalidates the archived result', () => {
  const b = structuredClone(state); b.source.versions[1].text += ' Express delivery is guaranteed.';
  assert.throws(() => verify(b));
});
test('an output for the held job or a missing replay check fails verification', () => {
  const b = structuredClone(state); b.workflows[0].actions.find(a => a.id === 'EXPRESS').execution = {};
  assert.throws(() => verify(b));
  const missing = structuredClone(state); missing.workflows[0].attempts.pop();
  assert.throws(() => verify(missing));
});
