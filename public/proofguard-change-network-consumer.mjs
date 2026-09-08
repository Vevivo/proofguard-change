/** Autonomous protected-artifact consumer for ProofGuard Change Network v2.
 * Supply a genlayer-js@1.1.8 Studionet client and the audited source digest.
 * No supplier API, external purchase or payment is performed by this adapter.
 */
export async function runProtectedJob({client,contract,sourceId,workflowId,jobId,expectedRevision,expectedIntentHash,expectedCodeSha256,sha256,finalize}) {
 const { TransactionHashVariant } = await import('genlayer-js/types');
 if (BigInt(await client.request({method:'eth_chainId',params:[]})) !== 61999n) throw new Error('CHAIN_MISMATCH');
 const code=await client.getContractCode(contract);
 if (await sha256(code) !== expectedCodeSha256) throw new Error('CONTRACT_CODE_MISMATCH');
 const read=async (method,args)=>client.readContract({address:contract,functionName:method,args,transactionHashVariant:TransactionHashVariant.LATEST_FINAL});
 if (await read('get_policy',[]) !== 'proofguard-change/2.0') throw new Error('POLICY_MISMATCH');
 const b=JSON.parse(await read('get_source_bundle',[sourceId]));
 const w=b.workflows.find(w=>w.id===workflowId),a=w?.actions.find(a=>a.id===jobId);
 if (!a || w.source_id !== sourceId || b.source.id !== sourceId) throw new Error('JOB_SOURCE_MISMATCH');
 if (b.source.revision !== expectedRevision) throw new Error('STALE_SOURCE_REVISION');
 if (a.intent_hash !== expectedIntentHash || await sha256(a.intent_json) !== expectedIntentHash) throw new Error('INTENT_MISMATCH');
 if (a.execution) throw new Error('ALREADY_EXECUTED');
 if (a.gate !== 'READY' || !a.active_permit) throw new Error(a.gate === 'READY'?'AUTHORIZATION_REQUIRED':a.gate);
 // The contract rechecks revision, intent, executor, review and permit atomically
 // with output creation. This preliminary read is not an external-action permit.
 const args=[workflowId,jobId,BigInt(expectedRevision),expectedIntentHash];
 const hash=await client.writeContract({address:contract,functionName:'execute_action',args,value:0n});
 await finalize(hash);
 const final=JSON.parse(await read('get_case',[workflowId]));
 const action=final.actions.find(a=>a.id===jobId),output=action?.execution;
 if (!output || output.revision !== expectedRevision || output.intent_hash !== expectedIntentHash || output.permit_id !== a.active_permit.id) throw new Error('OUTPUT_NOT_CONFIRMED');
 if (await sha256(output.output_json) !== output.output_sha256) throw new Error('OUTPUT_DIGEST_MISMATCH');
 return {chainId:61999,contract,sourceId,workflowId,jobId,transactionHash:hash,execution:output};
}
