// Device-local recovery pointers only. Never cache a decision as chain authority.
const PREFIX = "proofguard-change/1:";
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const METHODS = ["create_case", "revise_source", "adjudicate", "release_action", "deploy"];
export function readPending(storage) {
  try {
    const value = JSON.parse(storage.getItem(PREFIX + "pending") || "null");
    if (!value || value.chainId !== 61997 || !HASH.test(value.hash) || !METHODS.includes(value.method)) return null;
    if (value.method !== "deploy" && (!ADDRESS.test(value.contract) || typeof value.caseId !== "string" || !value.caseId.trim() || value.caseId.length > 80)) return null;
    return value;
  } catch { return null; }
}
export function rememberPending(storage, value) {
  try {
    if (value.failed) { storage.removeItem(PREFIX + "pending"); return; }
    if (!HASH.test(value.hash || "")) return;
    storage.setItem(PREFIX + "pending", JSON.stringify({ chainId: 61997, hash: value.hash, contract: value.contract, caseId: value.caseId, method: value.method }));
  } catch { /* Device storage may be disabled; chain checks remain authoritative. */ }
}
export function clearPending(storage, hash) {
  try { if (readPending(storage)?.hash === hash) storage.removeItem(PREFIX + "pending"); } catch { /* optional */ }
}
const archiveKey = (contract, caseId, revision) => PREFIX + `archive:${contract.toLowerCase()}:${caseId}:${revision}`;
export function readArchive(storage, contract, caseId, revision) {
  try {
    const value = JSON.parse(storage.getItem(archiveKey(contract, caseId, revision)) || "null");
    if (!value || value.contract?.toLowerCase() !== contract.toLowerCase() || value.caseId !== caseId || value.revision !== revision) return null;
    const p = value.publication;
    const unknown = value.status === "SUBMITTING" || value.status === "UNKNOWN";
    if (unknown && !p) return { ...value, status: "UNKNOWN" };
    if ((!unknown && value.status !== "ACCEPTED") || !p || !/^[A-Za-z0-9_-]{43}$/.test(p.recordId) || !/^[a-f0-9]{64}$/.test(p.sha256) || !Number.isInteger(p.bytes) || p.bytes < 1 || p.bytes > 100_000) return null;
    // Regenerate the URL; never trust a stored link. Recheck every restored file.
    return { ...value, status: unknown ? "UNKNOWN" : value.status, publication: { ...p, contract, caseId, revision, url: `https://turbo-gateway.com/${p.recordId}`, retrieval: "NOT_CHECKED", arweaveSettlement: "NOT_VERIFIED" } };
  } catch { return null; }
}
export function rememberArchive(storage, value) {
  try { storage.setItem(archiveKey(value.contract, value.caseId, value.revision), JSON.stringify(value)); } catch { /* optional */ }
}
export function clearArchive(storage, contract, caseId, revision) {
  try { storage.removeItem(archiveKey(contract, caseId, revision)); } catch { /* optional */ }
}
