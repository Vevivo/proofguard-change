import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { reusableNetworkSetup } from '../genlayer/change-network-reuse.mjs';
const actual = JSON.parse(await fs.readFile(new URL('./fixtures/copilot-unreviewed-source.json', import.meta.url), 'utf8'));
const account = actual.source.publisher;
test('the existing Copilot setup reuses both exact intents without reviews or permits', () => {
  const setup = reusableNetworkSetup(actual, account);
  assert.equal(setup.sourceText, actual.source.versions[0].text);
  assert.equal(setup.sourceId, 'COPILOT-BUSINESS-01');
  assert.equal(setup.jobs.length, 2);
  setup.jobs.forEach((job, i) => {
    const old = actual.workflows[0].actions[i];
    assert.equal(job.condition, old.condition);
    assert.deepEqual(job.payload, JSON.parse(old.intent_json).payload);
    assert.equal(job.permits, undefined);
  });
});
test('another account cannot reuse this setup as its own', () => {
  assert.equal(reusableNetworkSetup(actual, ''), null);
  assert.equal(reusableNetworkSetup(actual, '0x' + 'f'.repeat(40)), null);
});
for (const [name, change] of [
  ['revised source', b => b.source.revision = 2],
  ['reviewed workflow', b => b.workflows[0].reviewed_revision = 1],
  ['existing permit', b => b.workflows[0].actions[0].permits.push({id:'permit'})],
  ['existing output', b => b.workflows[0].actions[0].execution = {id:'output'}],
  ['multiple workflows', b => b.workflows.push(structuredClone(b.workflows[0]))],
]) test(`${name} is not silently copied into a new baseline`, () => {
  const bundle = structuredClone(actual); change(bundle);
  assert.equal(reusableNetworkSetup(bundle, account), null);
});
