import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { consumeReleasedJob } from '../public/proofguard-change-consumer.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const expectedIntentJson = '{"payload":{"quantity":2},"target":"stock-team","tool":"purchase"}';
function fixture() {
  const intent_hash = hash(expectedIntentJson);
  const record = { schema:'proofguard-change/1.0', id:'CASE-1', revision:2, reviewed_revision:2,
    reviews:[{ revision:2, actions:[{ id:'stock', verdict:'NO_MATERIAL_CHANGE' }] }],
    actions:[{ id:'stock', intent_json:expectedIntentJson, intent_hash,
      release:{ id:'release-1', revision:2, effect:'REGISTERED_JOB_RELEASED', intent_json:expectedIntentJson, intent_hash } }] };
  const calls = [];
  const args = { client:{ chain:{id:61997}, getContractCode:async ()=>'code', readContract:async input=>{assert.equal(input.transactionHashVariant,'latest-final');return JSON.stringify(record);}},
    contract:'0x1111111111111111111111111111111111111111', chainId:61997, contractSourceSha256:hash('code'),
    caseId:'CASE-1', actionId:'stock', expectedIntentJson, execute:async (...values)=>{calls.push(values);return 'done';} };
  return {record,calls,args};
}
test('consumer passes exact finalized intent and durable idempotency key to the tool',async()=>{
  const {calls,args}=fixture(); assert.equal(await consumeReleasedJob(args),'done');
  assert.deepEqual(calls,[[JSON.parse(expectedIntentJson),{idempotencyKey:'release-1'}]]);
});
test('consumer cannot invoke an unapproved, unreleased or stale job',async()=>{
  for(const mutation of [r=>r.actions[0].release=null,r=>r.revision=3,r=>r.reviews[0].actions[0].verdict='MATERIAL_CHANGE']){
    const {record,calls,args}=fixture(); mutation(record); await assert.rejects(consumeReleasedJob(args));assert.equal(calls.length,0);
  }
});
test('consumer fails closed on changed parameters, untrusted code, wrong chain and RPC failure',async()=>{
  for(const mutation of [a=>a.expectedIntentJson='{}',a=>a.contractSourceSha256='0'.repeat(64),a=>a.chainId=1,a=>a.client.readContract=async()=>{throw new Error('offline');}]){
    const {calls,args}=fixture();mutation(args);await assert.rejects(consumeReleasedJob(args));assert.equal(calls.length,0);
  }
});
