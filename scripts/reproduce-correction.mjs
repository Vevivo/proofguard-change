#!/usr/bin/env node
// Explicit opt-in live test. Uses two test-only accounts; never changes the reference instance.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAccount, createClient, isSuccessful } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';

if (!process.argv.includes('--submit-test-transactions')) {
  console.log('This writes a NEW test instance on Studio Next (61997). Read docs/REVIEWER_GUIDE.md first.');
  console.log('Set PROOFGUARD_TEST_OWNER_KEY and PROOFGUARD_TEST_EXECUTOR_KEY, then add --submit-test-transactions.');
  process.exit(0);
}
assert(process.env.PROOFGUARD_TEST_OWNER_KEY && process.env.PROOFGUARD_TEST_EXECUTOR_KEY, 'Two explicit test keys are required');
const owner = createAccount(process.env.PROOFGUARD_TEST_OWNER_KEY);
const executor = createAccount(process.env.PROOFGUARD_TEST_EXECUTOR_KEY);
assert.notEqual(owner.address.toLowerCase(), executor.address.toLowerCase(), 'Use separate test accounts');
const clients = { owner: createClient({ chain: studioDevnet, account: owner }), executor: createClient({ chain: studioDevnet, account: executor }) };
const reader = createClient({ chain: studioDevnet });
assert.equal(await reader.getChainId(), 61997, 'Wrong test network');
const directory = path.resolve(process.env.PROOFGUARD_TEST_DIR || 'work/correction-next');
await fs.mkdir(directory, { recursive: true });
const file = path.join(directory, 'evidence.json');
const json = v => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x, 2);
const hash = s => createHash('sha256').update(s).digest('hex');
const code = await fs.readFile(new URL('../contracts/genlayer/change_network.py', import.meta.url), 'utf8');
const fixture = JSON.parse(await fs.readFile(new URL('../examples/correction-scenario.json', import.meta.url), 'utf8'));
let evidence;
try { evidence = JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
evidence ??= { schema: 'proofguard-correction-evidence/1', chainId: 61997, network: studioDevnet.name, contractSourceSha256: hash(code), fixtureSha256: hash(json(fixture)), accounts: { owner: owner.address, executor: executor.address }, transactions: [], checkpoints: {} };
assert.equal(evidence.contractSourceSha256, hash(code), 'Source changed during a resumed run');
assert.equal(evidence.fixtureSha256, hash(json(fixture)), 'Fixture changed during a resumed run');
assert.deepEqual(evidence.accounts, { owner: owner.address, executor: executor.address }, 'Resume with the same test accounts');
const save = () => fs.writeFile(file, json(evidence) + '\n');
const read = async () => JSON.parse(await reader.readContract({ address: evidence.contract, functionName: 'get_source_bundle', args: [fixture.sourceId], transactionHashVariant: 'latest-final' }));
async function finality(entry) {
  let previous;
  let readFailures = 0;
  for (let i = 0; i < 150; i++) {
    let tx;
    try { tx = await reader.getTransaction({ hash: entry.hash }); readFailures = 0; }
    catch (error) {
      if (++readFailures > 5) throw error;
      console.log(entry.name, 'Receipt temporarily unavailable; checking the same hash again');
      await new Promise(resolve => setTimeout(resolve, 2500));
      continue;
    }
    if (previous !== tx.statusName) { console.log(entry.name, tx.statusName, entry.hash); previous = tx.statusName; }
    if (['FINALIZED', 'UNDETERMINED', 'CANCELED', 'LEADER_TIMEOUT', 'VALIDATORS_TIMEOUT'].includes(tx.statusName)) {
      await fs.writeFile(path.join(directory, `${entry.name}.receipt.json`), json(tx) + '\n');
      entry.status = tx.statusName; entry.executionResult = tx.txExecutionResultName; entry.success = isSuccessful(tx); entry.observedAt = new Date().toISOString();
      await save();
      assert(entry.status === 'FINALIZED' && entry.success, `Transaction ${entry.name} did not succeed; preserved its hash. Do not resubmit blindly.`);
      return tx;
    }
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
  throw new Error(`Still pending: ${entry.hash}. Resume this command to inspect the SAME transaction.`);
}
async function submit(name, role, method, args = []) {
  let entry = evidence.transactions.find(t => t.name === name);
  if (!entry) {
    const client = clients[role];
    const call = method === 'deploy' ? { code: new TextEncoder().encode(code), args: [] } : { address: evidence.contract, functionName: method, args };
    const quote = method === 'deploy' ? await client.estimateTransactionFees() : await client.estimateTransactionFeesForWrite(call);
    assert(quote.feeValue <= 2n * 10n ** 18n, 'Fee exceeds this test runner limit');
    assert(await client.getBalance({ address: client.account.address }) > quote.feeValue, 'Fund this test-only account with the Studio Next faucet first');
    const fees = { distribution: quote.distribution, feeValue: quote.feeValue };
    const txHash = method === 'deploy' ? await client.deployContract({ ...call, fees }) : await client.writeContract({ ...call, fees });
    entry = { name, role, method, args, hash: txHash, submittedAt: new Date().toISOString() };
    evidence.transactions.push(entry); await save(); console.log('Submitted', name, txHash);
  }
  const tx = await finality(entry);
  if (method === 'deploy') {
    evidence.contract = tx.txDataDecoded?.contractAddress || tx.recipient || tx.to_address;
    assert.match(evidence.contract || '', /^0x[0-9a-f]{40}$/i);
    assert.equal(await reader.getContractCode(evidence.contract), code, 'Deployed code differs');
    await save();
  } else if (!evidence.checkpoints[name]) { evidence.checkpoints[name] = await read(); await save(); }
  return evidence.checkpoints[name];
}
const wf = b => b.workflows.find(w => w.id === fixture.workflowId);
const job = (b, id) => wf(b).actions.find(a => a.id === id);
const attempt = b => wf(b).attempts.at(-1);
await submit('deploy', 'owner', 'deploy');
await submit('publish-v1', 'owner', 'publish_source', [fixture.sourceId, fixture.title, fixture.before]);
await submit('register', 'owner', 'register_workflow', [fixture.workflowId, fixture.workflowTitle, fixture.sourceId, 1, executor.address, JSON.stringify(fixture.jobs)]);
const baseline = await submit('review-v1', 'owner', 'review_source', [fixture.sourceId, 1]);
for (const id of ['STANDARD', 'EXPRESS']) {
  assert.equal(job(baseline, id).gate, 'READY', `Baseline ${id} unsupported; inspect the actual review`);
  await submit(`permit-v1-${id}`, 'owner', 'authorize_action', [fixture.workflowId, id, 1, job(baseline, id).intent_hash]);
}
const changed = await submit('revise-v2', 'owner', 'revise_source', [fixture.sourceId, 1, fixture.after]);
for (const a of wf(changed).actions) { assert.equal(a.gate, 'AWAITING_REVIEW'); assert.equal(a.active_permit, null); }
const intent = id => job(baseline, id).intent_hash;
for (const id of ['STANDARD', 'EXPRESS']) {
  const blocked = await submit(`stale-${id}`, 'executor', 'execute_action', [fixture.workflowId, id, 1, intent(id)]);
  assert.equal(attempt(blocked).code, 'STALE_SOURCE_REVISION'); assert.equal(attempt(blocked).allowed, false); assert.equal(job(blocked, id).execution, null);
}
const reviewed = await submit('review-v2', 'owner', 'review_source', [fixture.sourceId, 2]);
assert.equal(job(reviewed, 'STANDARD').gate, 'READY'); assert.equal(job(reviewed, 'EXPRESS').gate, 'MATERIAL_CHANGE');
const denied = await submit('held-EXPRESS', 'owner', 'authorize_action', [fixture.workflowId, 'EXPRESS', 2, intent('EXPRESS')]);
assert.equal(attempt(denied).code, 'MATERIAL_CHANGE'); assert.equal(attempt(denied).allowed, false);
const noPermit = await submit('missing-current-permit', 'executor', 'execute_action', [fixture.workflowId, 'STANDARD', 2, intent('STANDARD')]);
assert.equal(attempt(noPermit).code, 'AUTHORIZATION_REQUIRED'); assert.equal(job(noPermit, 'STANDARD').execution, null);
await submit('permit-v2-STANDARD', 'owner', 'authorize_action', [fixture.workflowId, 'STANDARD', 2, intent('STANDARD')]);
const executed = await submit('execute-STANDARD', 'executor', 'execute_action', [fixture.workflowId, 'STANDARD', 2, intent('STANDARD')]);
assert.equal(attempt(executed).allowed, true);
const output = job(executed, 'STANDARD').execution;
assert.equal(output.revision, 2); assert.equal(hash(output.output_json), output.output_sha256);
const replay = await submit('replay-STANDARD', 'executor', 'execute_action', [fixture.workflowId, 'STANDARD', 2, intent('STANDARD')]);
assert.equal(attempt(replay).code, 'ALREADY_EXECUTED'); assert.equal(attempt(replay).allowed, false);
assert.deepEqual(job(replay, 'STANDARD').execution, output); assert.equal(job(replay, 'EXPRESS').execution, null);
evidence.completedAt = new Date().toISOString(); evidence.result = 'PASS'; await save();
console.log(json({ result: evidence.result, contract: evidence.contract, chainId: 61997, transactions: evidence.transactions.length, evidence: file }));
