// Separate v2/Studionet namespace. Device-local pointers are never chain evidence.
const PREFIX = 'proofguard-network/2:61999:';
const METHODS = ['publish_source','approve_workflow_owner','register_workflow','revise_source','review_source','authorize_action','execute_action','deploy'];
export function readNetworkPending(storage) {
  try {
    const p = JSON.parse(storage.getItem(PREFIX + 'pending') || 'null');
    if (!p || !/^0x[\da-f]{64}$/i.test(p.hash) || !METHODS.includes(p.method) || (p.method !== 'deploy' && !/^0x[\da-f]{40}$/i.test(p.contract))) return null;
    return p;
  } catch { return null; }
}
export function rememberNetworkPending(storage, p) {
  try {
    if (p.failed || p.finalized) { if (readNetworkPending(storage)?.hash === p.hash) storage.removeItem(PREFIX+'pending'); return; }
    if (/^0x[\da-f]{64}$/i.test(p.hash || '') && METHODS.includes(p.method)) storage.setItem(PREFIX+'pending',JSON.stringify(p));
  } catch { /* Device storage is optional. */ }
}
export function readNetworkArchive(storage, contract, sourceId, revision) {
  try {
    const p=JSON.parse(storage.getItem(PREFIX+`archive:${contract.toLowerCase()}:${sourceId}:${revision}`) || 'null');
    if (!p || !/^[\w-]{43}$/.test(p.recordId) || !/^[\da-f]{64}$/.test(p.sha256) || p.contract.toLowerCase() !== contract.toLowerCase() || p.caseId !== sourceId || p.revision !== revision || !Number.isInteger(p.bytes) || p.bytes < 1 || p.bytes > 100000) return null;
    return {...p,url:`https://turbo-gateway.com/${p.recordId}`,retrieval:'NOT_CHECKED',arweaveSettlement:'NOT_VERIFIED'};
  } catch { return null; }
}
export function rememberNetworkArchive(storage,p) {
  try { storage.setItem(PREFIX+`archive:${p.contract.toLowerCase()}:${p.caseId}:${p.revision}`,JSON.stringify(p)); } catch { /* Optional recovery. */ }
}
export function clearNetworkArchive(storage,contract,sourceId,revision) {
  try { storage.removeItem(PREFIX+`archive:${contract.toLowerCase()}:${sourceId}:${revision}`); } catch { /* Optional recovery. */ }
}
