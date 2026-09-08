#!/usr/bin/env node
/** Run once against finalized v2 state. Default: inspect; --execute sends writes.
 * The source/code is NOT uploaded by this runner. Deployment is a separate step.
 * GENLAYER_EXECUTOR_KEY is read locally; it is never printed or sent in a payload.
 */
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from 'genlayer-studionet';
import { studionet } from 'genlayer-studionet/chains';
import { TransactionHashVariant } from 'genlayer-studionet/types';
import { privateKeyToAccount } from 'viem/accounts';
import { runProtectedJob } from '../public/proofguard-change-network-consumer.mjs';
import { trackSubmittedTransaction } from '../genlayer/change-transaction.mjs';
const argv=process.argv.slice(2),execute=argv.includes('--execute');
const value=flag=>argv[argv.indexOf(flag)+1];
const contract=argv.includes('--contract')?value('--contract'):null, sourceId=argv.includes('--source')?value('--source'):null;
if (!/^0x[\da-f]{40}$/i.test(contract||'') || !sourceId) throw new Error('Usage: node agents/change-network-runner.mjs --contract 0x… --source SOURCE-ID [--execute]');
const account=execute?privateKeyToAccount(process.env.GENLAYER_EXECUTOR_KEY || ''):undefined;
const client=createClient({chain:studionet,...(account?{account}:{})});
const sha256=text=>createHash('sha256').update(text,'utf8').digest('hex');
const code=await fs.readFile(fileURLToPath(new URL('../contracts/genlayer/change_network.py',import.meta.url)),'utf8');
if (await client.getContractCode(contract) !== code) throw new Error('CONTRACT_CODE_MISMATCH');
const b=JSON.parse(await client.readContract({address:contract,functionName:'get_source_bundle',args:[sourceId],transactionHashVariant:TransactionHashVariant.LATEST_FINAL}));
for (const w of b.workflows) for (const a of w.actions) {
 const eligible=a.gate==='READY' && !!a.active_permit && !a.execution;
 console.log(JSON.stringify({workflow:w.id,job:a.id,gate:a.gate,permit:!!a.active_permit,mode:execute?'EXECUTE':'INSPECT'}));
 if (!execute || !eligible || w.executor.toLowerCase() !== account.address.toLowerCase()) continue;
 const result=await runProtectedJob({client,contract,sourceId,workflowId:w.id,jobId:a.id,expectedRevision:b.source.revision,expectedIntentHash:a.intent_hash,expectedCodeSha256:sha256(code),sha256,
  finalize:hash=>trackSubmittedTransaction({hash,onProgress:p=>console.log(JSON.stringify({status:p.label,hash:p.hash})),read:h=>client.getTransaction({hash:h})})});
 const outputDir=process.env.PROOFGUARD_OUTPUT_DIR||'outputs';await fs.mkdir(outputDir,{recursive:true});
 const filename=`${w.id}-${a.id}-${result.execution.id}.json`;
 await fs.writeFile(`${outputDir}/${filename}`,result.execution.output_json,{flag:'wx'});
 console.log(JSON.stringify({created:filename,sha256:result.execution.output_sha256,transaction:result.transactionHash}));
}
