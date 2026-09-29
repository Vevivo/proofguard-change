// Read-only verification; uses the pinned Studionet SDK alias in package.json.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createClient } from 'genlayer-studionet';
import { studionet } from 'genlayer-studionet/chains';

const evidence = JSON.parse(fs.readFileSync(new URL('./live-evidence.json', import.meta.url), 'utf8'));
assert.equal(evidence.chainId, 61999);
const client = createClient({chain: studionet});
const source = fs.readFileSync(new URL('./contract.py', import.meta.url), 'utf8');
assert.equal(createHash('sha256').update(source).digest('hex'), evidence.sourceSha256);
assert.equal(await client.getContractCode(evidence.address), source, 'Deployed code mismatch');

const successful = [evidence.deployHash, ...Object.values(evidence.transactions).filter(t => t.success).map(t => t.hash)];
for (const hash of successful) {
  const tx = await client.getTransaction({hash});
  assert.equal(tx.statusName, 'FINALIZED');
  assert.equal(tx.result_name ?? tx.resultName, 'MAJORITY_AGREE');
  const receipts = Array.isArray(tx.consensus_data?.leader_receipt) ? tx.consensus_data.leader_receipt : [tx.consensus_data?.leader_receipt];
  const leader = receipts.find(r => r?.mode === 'leader');
  assert.equal(leader?.execution_result, 'SUCCESS');
  assert.equal(leader?.result?.status, 'return');
}
for (const recorded of Object.values(evidence.transactions).filter(t => !t.success)) {
  const tx = await client.getTransaction({hash:recorded.hash});
  assert.equal(tx.statusName, recorded.status);
  assert.equal(tx.result_name ?? tx.resultName, recorded.result);
  console.log(`Recorded unsuccessful attempt: ${recorded.hash} (${recorded.status})`);
}
const state = JSON.parse(await client.readContract({address:evidence.address, functionName:'get_state', args:[], transactionHashVariant:'latest-final'}));
for (const [id, recorded] of Object.entries(evidence.state.cases)) {
  const actual = state.cases[id];
  assert.equal(actual.id, recorded.id);
  assert.equal(actual.policy_id, recorded.policy_id);
  assert.equal(actual.claim, recorded.claim);
  assert.equal(actual.status, recorded.status);
  if (recorded.receipt === null) {
    assert.equal(actual.receipt, null);
    console.log(`${id}: ${recorded.status}, no completed receipt`);
  } else {
    assert.equal(actual.receipt.receipt_hash, recorded.receipt.receipt_hash);
    assert.deepEqual(actual.receipt.decision, recorded.receipt.decision);
    console.log(`${id}: ${recorded.status} (${actual.receipt.receipt_hash})`);
  }
}
assert.deepEqual(state.policies.HTTP429, evidence.state.policies.HTTP429);
console.log(`Verified source, ${successful.length} successful transactions, recorded unsuccessful attempts, and finalized state on Studionet ${evidence.chainId}.`);
