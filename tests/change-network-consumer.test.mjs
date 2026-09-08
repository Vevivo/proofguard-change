import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runProtectedJob } from '../public/proofguard-change-network-consumer.mjs';
const digest=t=>createHash('sha256').update(t).digest('hex');
function setup() {
 const intent='{"tool":"prepare_price_report"}',hash=digest(intent),output='{"kind":"PRICE_REPORT"}';let writes=0;
 const job={id:'price',intent_json:intent,intent_hash:hash,gate:'READY',active_permit:{id:'permit-v2'},execution:null};
 const bundle={source:{id:'SRC',revision:2},workflows:[{id:'WF',source_id:'SRC',actions:[job]}]};
 const final={actions:[{...job,execution:{revision:2,intent_hash:hash,permit_id:'permit-v2',output_json:output,output_sha256:digest(output)}}]};
 const client={request:async()=> '0xf22f',getContractCode:async()=> 'audited code',readContract:async({functionName})=>functionName==='get_policy'?'proofguard-change/2.0':JSON.stringify(functionName==='get_source_bundle'?bundle:final),writeContract:async()=>{writes++;return '0x'+'1'.repeat(64);}};
 const args={client,contract:'0x'+'2'.repeat(40),sourceId:'SRC',workflowId:'WF',jobId:'price',expectedRevision:2,expectedIntentHash:hash,expectedCodeSha256:digest('audited code'),sha256:digest,finalize:async()=>{}};
 return {args,client,bundle,job,final,writes:()=>writes};
}
test('returns exact verified protected output',async()=>{const s=setup();const r=await runProtectedJob(s.args);assert.equal(r.execution.output_sha256,digest(r.execution.output_json));assert.equal(s.writes(),1);});
test('Studionet output uses standard SDK gas handling without a fee-policy request',async()=>{const s=setup();let submitted;s.client.writeContract=async args=>{submitted=args;return '0x'+'1'.repeat(64);};await runProtectedJob(s.args);assert.equal(submitted.functionName,'execute_action');assert.equal(submitted.value,0n);assert.equal(Object.hasOwn(submitted,'fees'),false);});
for(const [label,change,code] of [
 ['wrong chain',s=>s.client.request=async()=> '0xf22d','CHAIN_MISMATCH'],
 ['unexpected contract',s=>s.client.getContractCode=async()=> 'different','CONTRACT_CODE_MISMATCH'],
 ['stale source',s=>s.bundle.source.revision=3,'STALE_SOURCE_REVISION'],
 ['changed intent',s=>s.job.intent_json='changed','INTENT_MISMATCH'],
 ['missing authorization',s=>s.job.active_permit=null,'AUTHORIZATION_REQUIRED'],
 ['held job',s=>s.job.gate='MATERIAL_CHANGE','MATERIAL_CHANGE'],
 ['already executed',s=>s.job.execution={id:'prior'},'ALREADY_EXECUTED'],
]) test(`${label} never sends a write`,async()=>{const s=setup();change(s);await assert.rejects(runProtectedJob(s.args),new RegExp(code));assert.equal(s.writes(),0);});
test('changed source between read and write cannot masquerade as an output',async()=>{const s=setup();s.final.actions[0].execution=null;await assert.rejects(runProtectedJob(s.args),/OUTPUT_NOT_CONFIRMED/);assert.equal(s.writes(),1);});
test('mismatched output digest is rejected',async()=>{const s=setup();s.final.actions[0].execution.output_json='altered';await assert.rejects(runProtectedJob(s.args),/OUTPUT_DIGEST_MISMATCH/);});
test('failed finality never returns an execution claim',async()=>{const s=setup();s.args.finalize=async()=>{throw Error('FAILED_FINALITY');};await assert.rejects(runProtectedJob(s.args),/FAILED_FINALITY/);});
