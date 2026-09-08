import { isSuccessful } from "genlayer-js";

export class TransactionReadUnavailable extends Error {
  constructor(hash) {
    super("Transaction submitted, but its latest status could not be read. Check this transaction again without submitting another.");
    this.name = "TransactionReadUnavailable";
    this.hash = hash;
  }
}

export class TransactionExecutionFailed extends Error {
  constructor(hash, detail) {
    const explanations = {
      QUOTE_NOT_IN_EVIDENCE: "The review was rolled back because an AI citation did not exactly match the registered source. No review or permission was saved. Use the updated review engine.",
      REVIEW_FORMAT_RETRY_EXHAUSTED: "The reviewers could not produce a valid evidence reference after two attempts. No review or permission was saved. View the transaction record.",
      UNDETERMINED: "GenLayer did not reach an accepted decision for this transaction. View the transaction record for the execution details.",
    };
    super(explanations[detail] || `The GenLayer transaction did not succeed: ${detail}. View the transaction record.`);
    this.name = "TransactionExecutionFailed";
    this.hash = hash;
  }
}

export class TransactionOutcomeUnavailable extends TransactionReadUnavailable {
  constructor(hash) {
    super(hash);
    this.name = "TransactionOutcomeUnavailable";
    this.message = "The transaction is finalized, but its execution result could not be confirmed. Recover this transaction to check again; do not submit another.";
  }
}

// Studio 1.1.x exposes the current leader's VM result in consensus_data.
// Newer networks expose txExecutionResultName. Finality alone proves neither.
export function transactionExecutionOutcome(tx) {
  if (tx.txExecutionResultName != null || tx.txExecutionResult != null) {
    if (isSuccessful(tx)) return { state: "success" };
    if (tx.txExecutionResultName === "FINISHED_WITH_ERROR" || (tx.txExecutionResultName == null && String(tx.txExecutionResult) === "2")) return { state: "failure", detail: "FINISHED_WITH_ERROR" };
    return { state: "unknown" };
  }
  const raw = tx.consensus_data?.leader_receipt;
  const receipts = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  const leaders = receipts.filter(receipt => receipt?.mode === "leader");
  if (leaders.length !== 1) return { state: "unknown" };
  const leader = leaders[0];
  const resultStatus = leader.result?.status;
  const vm = leader.genvm_result;
  if (leader.execution_result === "ERROR" || ["rollback", "contract_error", "user_error", "vm_error", "error"].includes(resultStatus) || vm?.error_code || vm?.raw_error) {
    const payload = leader.result?.payload;
    const known = typeof payload === "string" && ["QUOTE_NOT_IN_EVIDENCE", "REVIEW_FORMAT_RETRY_EXHAUSTED"].includes(payload) ? payload : undefined;
    return { state: "failure", detail: String(known || vm?.error_code || vm?.error_description || resultStatus || "Contract execution failed").slice(0, 240) };
  }
  const consensus = tx.result_name ?? tx.resultName;
  if (consensus === "MAJORITY_AGREE" && leader.execution_result === "SUCCESS" && resultStatus === "return") return { state: "success" };
  return { state: "unknown" };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function boundedRead(read, hash, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      read(hash),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("READ_TIMEOUT")), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

// This helper can only read an already-submitted hash. Retries never request
// a wallet signature or repeat the original contract write.
export async function trackSubmittedTransaction({
  hash, read, onProgress, delay = sleep, now = Date.now,
  intervalMs = 5000, readTimeoutMs = 20000, maxReadErrors = 3, maxDurationMs = 3600000,
}) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("A valid transaction hash is required.");
  const started = now();
  let readErrors = 0;
  onProgress({ label: "Checking the submitted transaction", hash });
  while (now() - started < maxDurationMs) {
    let tx;
    try {
      tx = await boundedRead(read, hash, readTimeoutMs);
      if (!tx || typeof tx.hash !== "string" || tx.hash.toLowerCase() !== hash.toLowerCase()) throw new Error("TRANSACTION_ID_MISMATCH");
      readErrors = 0;
    } catch {
      readErrors += 1;
      onProgress({ label: "Connection interrupted; rechecking the submitted transaction", hash, recoverable: true });
      if (readErrors >= maxReadErrors) throw new TransactionReadUnavailable(hash);
      await delay(intervalMs);
      continue;
    }
    const status = tx.statusName || (typeof tx.status === "string" ? tx.status : "");
    if (status === "FINALIZED") {
      const outcome = transactionExecutionOutcome(tx);
      if (outcome.state === "unknown") {
        onProgress({ label: "Finalized; execution result needs confirmation", hash, recoverable: true });
        throw new TransactionOutcomeUnavailable(hash);
      }
      if (outcome.state === "failure") {
        onProgress({ label: "GenLayer execution failed", hash, failed: true });
        throw new TransactionExecutionFailed(hash, outcome.detail);
      }
      onProgress({ label: "Successfully finalized on GenLayer", hash, finalized: true });
      return tx;
    }
    if (["CANCELED", "UNDETERMINED", "LEADER_TIMEOUT", "VALIDATORS_TIMEOUT"].includes(status)) {
      onProgress({ label: "GenLayer could not complete the transaction", hash, failed: true });
      const outcome = transactionExecutionOutcome(tx);
      throw new TransactionExecutionFailed(hash, outcome.state === "failure" ? outcome.detail : status);
    }
    onProgress({ label: status === "ACCEPTED" ? "Decision accepted; awaiting finality" : "Waiting for the GenLayer decision", hash });
    await delay(intervalMs);
  }
  onProgress({ label: "The wait ended; check the same transaction to recover its status", hash, recoverable: true });
  throw new TransactionReadUnavailable(hash);
}
