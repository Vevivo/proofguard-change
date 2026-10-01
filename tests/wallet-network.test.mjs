import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureWalletNetwork, requestWalletAccount, walletErrorMessage} from '../genlayer/wallet-network.mjs';
const chain={id:61999,name:'GenLayer Studionet',rpcUrls:{default:{http:['https://studio.genlayer.com/api']}},nativeCurrency:{name:'GEN Token',symbol:'GEN',decimals:18},blockExplorers:{default:{url:'https://explorer-studio.genlayer.com'}}};
const account='0x1111111111111111111111111111111111111111';
test('relay failures preserve an unknown transaction outcome and never promise no submission',()=>{
 for(const detail of ['RPCErr53: Transport request timed out','Failed to publish message after all retries']){
  const message=walletErrorMessage(detail);
  assert.match(message,/check pending requests and wallet activity/);
  assert.match(message,/will not resend automatically/);
  assert.doesNotMatch(message,/No transaction was submitted|transaction failed/i);
 }
 assert.equal(walletErrorMessage('SOURCE_NOT_FOUND'),'SOURCE_NOT_FOUND');
});
test('already granted account is reused without re-opening mobile connection',async()=>{
 const calls=[];assert.equal(await requestWalletAccount({request:async r=>{calls.push(r.method);return [account];}}),account);
 assert.deepEqual(calls,['eth_accounts']);
});
test('an empty account list requests access once',async()=>{
 const calls=[];assert.equal(await requestWalletAccount({request:async r=>{calls.push(r.method);return r.method==='eth_accounts'?[]:[account];}}),account);
 assert.deepEqual(calls,['eth_accounts','eth_requestAccounts']);
});
test('rejected account permission is not retried',async()=>{
 const calls=[];await assert.rejects(requestWalletAccount({request:async r=>{calls.push(r.method);if(r.method==='eth_accounts')return [];throw new Error('Rejected');}}),/Rejected/);
 assert.deepEqual(calls,['eth_accounts','eth_requestAccounts']);
});
test('malformed selected account cannot create a signing client',async()=>{
 await assert.rejects(requestWalletAccount({request:async()=>['not-an-address']}),/No wallet account/);
});
test('correct network needs no wallet permission request',async()=>{
 const calls=[];await ensureWalletNetwork({request:async r=>{calls.push(r.method);return '0xf22f';}},chain);
 assert.deepEqual(calls,['eth_chainId','eth_chainId']);
});
test('wallet rejection never requests an add or a retry',async()=>{
 const calls=[];await assert.rejects(ensureWalletNetwork({request:async r=>{calls.push(r.method);if(r.method==='eth_chainId')return '0x1';throw Object.assign(new Error('Rejected'),{code:4001});}},chain),/Rejected/);
 assert.deepEqual(calls,['eth_chainId','wallet_switchEthereumChain']);
});
test('an unknown network requests exactly the declared test chain',async()=>{
 let added=false,current='0x1';const calls=[];
 await ensureWalletNetwork({request:async r=>{calls.push(r);if(r.method==='eth_chainId')return current;if(r.method==='wallet_addEthereumChain'){assert.equal(r.params[0].chainId,'0xf22f');assert.deepEqual(r.params[0].rpcUrls,chain.rpcUrls.default.http);added=true;return null;}if(!added)throw Object.assign(new Error('Unknown'),{code:4902});current='0xf22f';}},chain);
 assert.deepEqual(calls.map(r=>r.method),['eth_chainId','wallet_switchEthereumChain','wallet_addEthereumChain','wallet_switchEthereumChain','eth_chainId']);
});
test('a wallet which remains on the wrong chain fails closed',async()=>{
 await assert.rejects(ensureWalletNetwork({request:async()=> '0x1'},chain),/Switch your wallet/);
});
