import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { sha256 as webSha256, toHex } from 'viem';
import { createInspectorCore, POLICY } from '../genlayer/inspector-core.mjs';
import { createInspector, sha256 } from '../agents/inspector.mjs';

const fixture = JSON.parse(await fs.readFile(new URL('../deployments/studio-next-correction-state.json', import.meta.url), 'utf8'));
function setup() {
  const bundle = structuredClone(fixture), calls = [], phases = [];
  const client = {
    request: async () => '0xf22d', getContractCode: async () => 'pinned source',
    readContract: async arg => { calls.push(arg); return arg.functionName === 'get_policy' ? POLICY : JSON.stringify(bundle); },
    writeContract: () => { throw Error('UNEXPECTED_WRITE'); },
  };
  const args = { client, chainId: 61997, contract: '0x' + 'a'.repeat(40), sourceId: bundle.source.id, expectedCodeSha256: sha256('pinned source') };
  return { bundle, calls, phases, client, args, browser: createInspectorCore({ ...args, sha256: text => webSha256(toHex(text)).slice(2), onProgress: p => phases.push(p) }), node: createInspector(args) };
}
test('browser and MCP inspection agree on real record shape and UTF-8 hashes', async () => {
  const s = setup(), a = await s.browser.inspectSource(), b = await s.node.inspectSource();
  const { observedAt: _a, ...web } = a, { observedAt: _b, ...node } = b;
  assert.deepEqual(web, node);
  assert.equal(webSha256(toHex('İzin · evidence 🛡')).slice(2), sha256('İzin · evidence 🛡'));
  assert(s.calls.every(c => c.transactionHashVariant === 'latest-final'));
  assert.equal(s.phases.length, 4);
});
test('a corrupt output rejects the entire displayed record, even when another job is selected', async () => {
  const s = setup();
  s.bundle.workflows[0].actions[0].execution.output_json += 'altered';
  await assert.rejects(s.browser.inspectSource(), /OUTPUT_DIGEST_MISMATCH/);
});
test('a matching output digest cannot hide a changed target', async () => {
  const s = setup(), e = s.bundle.workflows[0].actions[0].execution;
  const output = JSON.parse(e.output_json); output.target = 'different-recipient';
  e.output_json = JSON.stringify(output); e.output_sha256 = sha256(e.output_json);
  await assert.rejects(s.browser.inspectSource(), /OUTPUT_BINDING_MISMATCH/);
});
test('a failed refresh cannot return the last successful snapshot', async () => {
  const s = setup(); await s.browser.inspectSource();
  s.client.request = async () => { throw Error('unavailable'); };
  await assert.rejects(s.browser.inspectSource(), /RPC_READ_FAILED/);
});
test('malformed history and non-JSON intents cannot receive a verified display', async () => {
  const s = setup(); s.bundle.workflows[0].reviews = {};
  await assert.rejects(s.browser.inspectSource(), /INVALID_WORKFLOW_HISTORY/);
  const t = setup(), action = t.bundle.workflows[0].actions[1];
  action.intent_json = 'not json'; action.intent_hash = sha256(action.intent_json);
  await assert.rejects(t.browser.inspectSource(), /INVALID_INTENT/);
});
