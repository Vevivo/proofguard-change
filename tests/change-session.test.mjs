import test from "node:test";
import assert from "node:assert/strict";
import { readPending, rememberPending, clearPending, readArchive, rememberArchive } from "../genlayer/change-session.mjs";
const contract = `0x${"a".repeat(40)}`;
const hash = `0x${"b".repeat(64)}`;
function device() { const data = new Map(); return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; }

test("page reload retains only a same-network transaction pointer, never a decision", () => {
  const storage = device();
  rememberPending(storage, { hash, contract, caseId: "CASE-1", method: "adjudicate", finalized: true, decision: "ALLOW" });
  const restored = readPending(storage);
  assert.deepEqual(restored, { chainId: 61997, hash, contract, caseId: "CASE-1", method: "adjudicate" });
  clearPending(storage, `0x${"c".repeat(64)}`);
  assert.ok(readPending(storage));
  clearPending(storage, hash);
  assert.equal(readPending(storage), null);
});
test("wrong network, malformed storage and unavailable device storage cannot restore authority", () => {
  const storage = device();
  storage.setItem("proofguard-change/1:pending", JSON.stringify({ chainId: 1, hash, contract, caseId: "CASE-1", method: "adjudicate" }));
  assert.equal(readPending(storage), null);
  storage.setItem("proofguard-change/1:pending", "corrupt");
  assert.equal(readPending(storage), null);
  assert.equal(readPending({ getItem() { throw new Error("storage unavailable"); } }), null);
});
test("a lost upload response blocks another automatic upload after reload", () => {
  const storage = device();
  rememberArchive(storage, { contract, caseId: "CASE-1", revision: 2, status: "SUBMITTING" });
  assert.equal(readArchive(storage, contract, "CASE-1", 2).status, "UNKNOWN");
  assert.equal(readArchive(storage, contract, "CASE-2", 2), null);
  assert.equal(readArchive(storage, contract, "CASE-1", 3), null);
});
test("a restored archive must be reverified and its stored URL cannot redirect the reader", () => {
  const storage = device();
  rememberArchive(storage, { contract, caseId: "CASE-1", revision: 2, status: "ACCEPTED", publication: { recordId: "R".repeat(43), sha256: "e".repeat(64), bytes: 999, retrieval: "VERIFIED", url: "javascript:alert(1)", arweaveSettlement: "FINALIZED" } });
  const restored = readArchive(storage, contract, "CASE-1", 2).publication;
  assert.equal(restored.retrieval, "NOT_CHECKED");
  assert.equal(restored.arweaveSettlement, "NOT_VERIFIED");
  assert.equal(restored.url, `https://turbo-gateway.com/${"R".repeat(43)}`);
});
