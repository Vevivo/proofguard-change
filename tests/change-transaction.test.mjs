import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { trackSubmittedTransaction, TransactionReadUnavailable, TransactionExecutionFailed, TransactionOutcomeUnavailable } from "../genlayer/change-transaction.mjs";

const hash = `0x${"a".repeat(64)}`;
const receipt = (statusName = "FINALIZED", txExecutionResultName = "FINISHED_WITH_RETURN") => ({ hash, statusName, txExecutionResultName });
const instant = async () => {};
const studioReceipt = JSON.parse(await fs.readFile(new URL('./fixtures/studionet-finalized-deploy.json', import.meta.url), 'utf8'));
const quoteFailure = JSON.parse(await fs.readFile(new URL('./fixtures/studionet-quote-failure.json', import.meta.url), 'utf8'));

for (const statusName of ['UNDETERMINED', 'FINALIZED']) test(`the actual quotation rollback is explained at ${statusName}`, async () => {
  const tx = { ...structuredClone(quoteFailure), statusName };
  const progress = [];
  await assert.rejects(trackSubmittedTransaction({hash:tx.hash, read:async()=>tx, onProgress:p=>progress.push(p)}), error =>
    error instanceof TransactionExecutionFailed && error.message.includes('citation did not exactly match'));
  assert.equal(progress.at(-1).failed, true);
  assert.equal(progress.some(p=>p.finalized), false);
});

test("the reported real Studio deployment succeeds using its leader VM receipt", async () => {
  const progress = [];
  const result = await trackSubmittedTransaction({ hash: studioReceipt.hash, onProgress: p => progress.push(p), read: async () => structuredClone(studioReceipt) });
  assert.equal(result.recipient, '0xda8686423E4e03f55b0590d2AFdC0a463750A3B1');
  assert.equal(progress.at(-1).finalized, true);
  assert.equal(progress.some(p => p.failed), false);
});

test("a finalized Studio VM error is never accepted even if validators agree", async () => {
  const tx = structuredClone(studioReceipt);
  tx.consensus_data.leader_receipt[0].execution_result = 'ERROR';
  tx.consensus_data.leader_receipt[0].result.status = 'user_error';
  const progress = [];
  await assert.rejects(trackSubmittedTransaction({ hash: tx.hash, onProgress: p => progress.push(p), read: async () => tx }), TransactionExecutionFailed);
  assert.equal(progress.at(-1).failed, true);
});

for (const [name, change] of [
  ['missing VM receipt', tx => { delete tx.consensus_data; }],
  ['unknown VM result', tx => { tx.consensus_data.leader_receipt[0].result.status = 'unknown'; }],
  ['no consensus agreement', tx => { tx.result_name = 'UNDETERMINED'; }],
  ['ambiguous leaders', tx => { tx.consensus_data.leader_receipt.push(structuredClone(tx.consensus_data.leader_receipt[0])); }],
]) test(`${name} stays recoverable without claiming success or failure`, async () => {
  const tx = structuredClone(studioReceipt); change(tx); const progress = [];
  await assert.rejects(trackSubmittedTransaction({ hash: tx.hash, onProgress: p => progress.push(p), read: async () => tx }), TransactionOutcomeUnavailable);
  assert.equal(progress.at(-1).recoverable, true);
  assert.equal(progress.some(p => p.failed || p.finalized), false);
});

test("an explicit modern execution error cannot be overridden by an old Studio success", async () => {
  const tx = { ...structuredClone(studioReceipt), txExecutionResultName: 'FINISHED_WITH_ERROR' };
  await assert.rejects(trackSubmittedTransaction({ hash: tx.hash, onProgress: () => {}, read: async () => tx }), TransactionExecutionFailed);
});

test("a numeric modern execution error remains a failure without a decoded name", async () => {
  const tx = { hash, statusName: 'FINALIZED', txExecutionResult: 2 };
  await assert.rejects(trackSubmittedTransaction({ hash, onProgress: () => {}, read: async () => tx }), TransactionExecutionFailed);
});

test("temporary RPC failures recover the same hash and ACCEPTED never grants finality", async () => {
  const progress = [], reads = [];
  const sequence = [new Error("Failed to fetch"), new Error("Failed to fetch"), receipt("ACCEPTED"), receipt()];
  const result = await trackSubmittedTransaction({ hash, delay: instant, onProgress: value => progress.push(value), read: async selected => {
    reads.push(selected);
    const next = sequence.shift();
    if (next instanceof Error) throw next;
    return next;
  } });
  assert.equal(result.statusName, "FINALIZED");
  assert.deepEqual(reads, [hash, hash, hash, hash]);
  assert.equal(progress.filter(item => item.finalized).length, 1);
  assert.equal(progress.at(-1).finalized, true);
  assert.equal(progress.some(item => item.failed), false);
  assert.ok(progress.some(item => item.recoverable));
});

test("unavailable reads preserve the submitted hash for a later read-only recovery", async () => {
  const progress = [];
  let reads = 0;
  await assert.rejects(trackSubmittedTransaction({ hash, delay: instant, onProgress: value => progress.push(value), read: async () => {
    reads += 1; throw new Error("Failed to fetch");
  } }), error => error instanceof TransactionReadUnavailable && error.hash === hash);
  assert.equal(reads, 3);
  assert.equal(progress.some(item => item.failed || item.finalized), false);
  assert.equal(progress.at(-1).recoverable, true);
  const recovered = await trackSubmittedTransaction({ hash, onProgress: () => {}, read: async selected => {
    assert.equal(selected, hash); return receipt();
  } });
  assert.equal(recovered.hash, hash);
});

test("a finalized execution error remains a genuine failure", async () => {
  const progress = [];
  await assert.rejects(trackSubmittedTransaction({ hash, onProgress: value => progress.push(value), read: async () => receipt("FINALIZED", "FINISHED_WITH_ERROR") }), TransactionExecutionFailed);
  assert.equal(progress.at(-1).failed, true);
  assert.equal(progress.some(item => item.finalized), false);
});

test("a finalized receipt for another transaction cannot grant success", async () => {
  const progress = [];
  await assert.rejects(trackSubmittedTransaction({ hash, delay: instant, onProgress: value => progress.push(value), read: async () => ({ ...receipt(), hash: `0x${"b".repeat(64)}` }) }), TransactionReadUnavailable);
  assert.equal(progress.some(item => item.finalized), false);
});

test("a pending transaction outliving the UI wait remains recoverable", async () => {
  let time = 0;
  const progress = [];
  await assert.rejects(trackSubmittedTransaction({ hash, now: () => time, maxDurationMs: 10, delay: async () => { time += 10; }, onProgress: value => progress.push(value), read: async () => receipt("PENDING") }), TransactionReadUnavailable);
  assert.equal(progress.at(-1).recoverable, true);
  assert.equal(progress.some(item => item.failed || item.finalized), false);
});

test("a hanging RPC read has a bounded recovery exit", async () => {
  const progress = [];
  await assert.rejects(trackSubmittedTransaction({ hash, readTimeoutMs: 10, maxReadErrors: 1, onProgress: value => progress.push(value), read: () => new Promise(() => {}) }), TransactionReadUnavailable);
  assert.equal(progress.at(-1).recoverable, true);
});
