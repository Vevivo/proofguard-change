/** Consume a finalized ProofGuard Change job with an integration-owned tool.
 * The trusted client must target the configured chain and contract. This is
 * an RPC-based check, not a cryptographic light client or an atomic cross-chain bridge.
 * The external tool MUST enforce the supplied idempotency key durably.
 */
async function hash(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export async function consumeReleasedJob({ client, contract, chainId, contractSourceSha256,
  caseId, actionId, expectedIntentJson, execute }) {
  if (client.chain?.id !== chainId || typeof execute !== 'function') throw new Error('INVALID_INTEGRATION');
  const source = await client.getContractCode(contract);
  if (await hash(source) !== contractSourceSha256) throw new Error('UNTRUSTED_CONTRACT_CODE');
  const raw = await client.readContract({ address: contract, functionName: 'get_case',
    args: [caseId], transactionHashVariant: 'latest-final' });
  const record = typeof raw === 'string' ? JSON.parse(raw) : null;
  if (record?.schema !== 'proofguard-change/1.0' || record.id !== caseId) throw new Error('INVALID_CASE');
  const action = record.actions.find(a => a.id === actionId);
  const release = action?.release;
  if (!release || release.effect !== 'REGISTERED_JOB_RELEASED') throw new Error('NOT_RELEASED');
  if (release.revision !== record.revision || record.reviewed_revision !== record.revision) throw new Error('STALE_RELEASE');
  const row = record.reviews.find(r => r.revision === release.revision)?.actions.find(a => a.id === actionId);
  if (row?.verdict !== 'NO_MATERIAL_CHANGE') throw new Error('NOT_APPROVED');
  const intentHash = await hash(expectedIntentJson);
  if (action.intent_json !== expectedIntentJson || release.intent_json !== expectedIntentJson ||
      action.intent_hash !== intentHash || release.intent_hash !== intentHash) throw new Error('INTENT_MISMATCH');
  return execute(JSON.parse(expectedIntentJson), { idempotencyKey: release.id });
}
