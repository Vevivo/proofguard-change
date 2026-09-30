#!/usr/bin/env node
// Read-only: no account, signature, faucet, deployment, or network write.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createClient, isSuccessful, decodeInputData } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { verifyCorrectionState, sha256 } from './correction-proof.mjs';

const load = async p => JSON.parse(await fs.readFile(new URL(p, import.meta.url), 'utf8'));
const reference = await load('../deployments/studio-next-correction.json');
const fixture = await load('../examples/correction-scenario.json');
const source = await fs.readFile(new URL('../contracts/genlayer/change_network.py', import.meta.url), 'utf8');
assert.equal(reference.chainId, 61997); assert.equal(sha256(source), reference.contractSourceSha256);
assert.deepEqual(reference.transactions.map(t => t.name), ['deploy', 'publish-v1', 'register', 'review-v1', 'permit-v1-STANDARD', 'permit-v1-EXPRESS', 'revise-v2', 'stale-STANDARD', 'stale-EXPRESS', 'review-v2', 'held-EXPRESS', 'missing-current-permit', 'permit-v2-STANDARD', 'execute-STANDARD', 'replay-STANDARD']);
assert.equal(new Set(reference.transactions.map(t => t.hash)).size, reference.transactions.length, 'Repeated transaction hash');
const offline = process.argv.includes('--offline');
const timeout = setTimeout(() => { console.error('Verification timed out. No transaction was submitted.'); process.exit(1); }, 120_000);
try {
  let bundle;
  if (offline) bundle = await load('../deployments/studio-next-correction-state.json');
  else {
    const c = createClient({ chain: studioDevnet });
    assert.equal(await c.getChainId(), 61997);
    assert.equal(await c.getContractCode(reference.contract), source, 'Deployed source mismatch');
    bundle = JSON.parse(await c.readContract({ address: reference.contract, functionName: 'get_source_bundle', args: [fixture.sourceId], transactionHashVariant: 'latest-final' }));
    // Small bounded batches; do not flood the public development RPC.
    for (let i = 0; i < reference.transactions.length; i += 3) {
      await Promise.all(reference.transactions.slice(i, i + 3).map(async entry => {
        const t = await c.getTransaction({ hash: entry.hash });
        assert.equal(t.statusName, 'FINALIZED', `${entry.name} is not final`);
        assert(isSuccessful(t), `${entry.name} execution did not succeed`);
        const sender = t.from_address || t.from || t.sender;
        assert.equal(sender?.toLowerCase(), reference.accounts[entry.role].toLowerCase(), `${entry.name} sender mismatch`);
        assert.equal((t.recipient || t.to_address)?.toLowerCase(), reference.contract.toLowerCase(), `${entry.name} contract mismatch`);
        assert.equal(t.leader_only, false, `${entry.name} must use validator consensus`);
        if (entry.method !== 'deploy') {
          const decoded = decodeInputData(t.tx_data.startsWith('0x') ? t.tx_data : `0x${t.tx_data}`, reference.contract);
          assert.equal(decoded?.callData?.get(''), entry.method, `${entry.name} method mismatch`);
          const normalized = v => JSON.stringify(v, (_, x) => typeof x === 'bigint' || typeof x === 'number' ? String(x) : x);
          assert.equal(normalized(decoded.callData.get('args')), normalized(entry.args), `${entry.name} arguments mismatch`);
        }
      }));
    }
  }
  const checks = verifyCorrectionState(bundle, fixture, reference.accounts);
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), mode: offline ? 'ARCHIVED_SNAPSHOT_ONLY' : 'LIVE_FINALIZED_READ', chainId: 61997, contract: reference.contract, transactionsChecked: offline ? 0 : reference.transactions.length, ...checks }, null, 2));
} finally { clearTimeout(timeout); }
