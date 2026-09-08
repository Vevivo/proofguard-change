import { createClient } from "genlayer-js";
import { TransactionHashVariant } from "genlayer-js/types";
import { studioDevnet } from "genlayer-js/chains";
import { formatEther, sha256 as sha256Bytes } from "viem";
import { transactionFees } from "./fee-profile.mjs";
import { trackSubmittedTransaction } from "./change-transaction.mjs";
import source from "../contracts/genlayer/change_impact.py?raw";

export const CHANGE_POLICY = "proofguard-change/1.0";
export const CHANGE_SOURCE = source;
export const CHANGE_EXPLORER = "https://explorer-studio-dev.genlayer.com";
export type ChangeAction = { id: string; label: string; condition: string; intent_json: string; intent_hash: string; release: null | { id: string; revision: number; intent_hash: string; intent_json: string; effect: string; external_execution: string } };
export type ReviewRow = { id: string; verdict: "MATERIAL_CHANGE" | "NO_MATERIAL_CHANGE" | "INSUFFICIENT_EVIDENCE"; reason: string; old_quote: string; new_quote: string };
export type ChangeCase = { schema: string; id: string; title: string; owner: string; publisher: string; revision: number; reviewed_revision: number; sources: { revision: number; text: string; sha256: string }[]; actions: ChangeAction[]; reviews: { revision: number; policy: string; source_sha256: string; actions: ReviewRow[] }[]; attempts: { index: number; action_id: string; requested_revision: number; current_revision: number; intent_hash: string; allowed: boolean; code: string; actor: string }[] };
export type TxProgress = { label: string; hash?: string; fee?: string; finalized?: boolean; recoverable?: boolean; failed?: boolean; contract?: string; caseId?: string; method?: string };
type Progress = (progress: TxProgress) => void;

export function reader() { return createClient({ chain: studioDevnet }); }
export function validAddress(address: string) { return /^0x[0-9a-fA-F]{40}$/.test(address) && !/^0x0{40}$/i.test(address); }
export async function sha256(text: string) {
  // The same exact UTF-8 digest also works in the HTTP development preview,
  // where browsers do not expose Web Crypto's secure-context-only subtle API.
  return sha256Bytes(new TextEncoder().encode(text)).slice(2);
}
export async function deadline<T>(promise: Promise<T>, ms = 25_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("GenLayer is taking longer to respond. Check the connection again.")), ms); })]); }
  finally { clearTimeout(timer); }
}
async function readWithRecovery<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await deadline(read()); }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (attempt >= 2 || !/failed to fetch|fetch failed|network|http request failed|longer to respond|timeout|timed out|429|502|503|504/i.test(message)) throw error;
      await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
}
export async function verifyContract(address: string) {
  if (!validAddress(address)) throw new Error("Enter a valid ProofGuard Change contract address.");
  const client = reader();
  const [code, policy] = await readWithRecovery(() => Promise.all([
    client.getContractCode(address as `0x${string}`),
    client.readContract({ address: address as `0x${string}`, functionName: "get_policy", args: [], transactionHashVariant: TransactionHashVariant.LATEST_FINAL }),
  ]));
  if (code !== source || policy !== CHANGE_POLICY) throw new Error("This address does not match the expected ProofGuard Change contract code.");
  return client;
}
export async function readCase(address: string, id: string): Promise<ChangeCase> {
  const client = await verifyContract(address);
  const raw = await readWithRecovery(() => client.readContract({ address: address as `0x${string}`, functionName: "get_case", args: [id], transactionHashVariant: TransactionHashVariant.LATEST_FINAL }));
  if (typeof raw !== "string") throw new Error("GenLayer did not return the expected case format.");
  const record = JSON.parse(raw) as ChangeCase;
  if (record.schema !== CHANGE_POLICY || record.id !== id || !Array.isArray(record.sources) || !Array.isArray(record.actions) || !record.sources.length || record.actions.length > 3) throw new Error("The case ID or schema does not match.");
  for (const version of record.sources) if (await sha256(version.text) !== version.sha256) throw new Error("Source integrity verification failed.");
  for (const action of record.actions) if (await sha256(action.intent_json) !== action.intent_hash) throw new Error("Job intent integrity verification failed.");
  return record;
}
export async function walletClient() {
  if (!window.ethereum) throw new Error("Open MetaMask or a compatible browser wallet to sign transactions.");
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
  if (!accounts[0]) throw new Error("No wallet account was selected.");
  const client = createClient({ chain: studioDevnet, account: accounts[0] as `0x${string}`, provider: window.ethereum as never });
  await client.connect("studioDevnet");
  return { client, account: accounts[0].toLowerCase() };
}
async function finalize(client: ReturnType<typeof reader>, hash: `0x${string}`, progress: Progress) {
  return trackSubmittedTransaction({ hash, onProgress: progress,
    read: (selectedHash: string) => client.getTransaction({ hash: selectedHash as Parameters<typeof client.getTransaction>[0]["hash"] }),
  });
}
export async function resumeChangeTransaction(hash: string, progress: Progress) {
  // Recovery uses the public reader, never the wallet or writeContract.
  return finalize(reader(), hash as `0x${string}`, progress);
}
export async function writeChange(address: string, method: string, args: (string | bigint)[], onProgress: Progress) {
  const progress: Progress = value => onProgress({ ...value, contract: address, caseId: String(args[0]), method });
  await verifyContract(address);
  const { client } = await walletClient();
  progress({ label: "Estimating the transaction fee" });
  const quote = await deadline(client.estimateTransactionFeesForWrite({ address: address as `0x${string}`, functionName: method, args, value: 0n, appealRounds: 1n, rotations: [1n, 1n] }), 90_000);
  progress({ label: "Review and sign the transaction in your wallet", fee: formatEther(quote.feeValue) });
  const hash = await client.writeContract({ address: address as `0x${string}`, functionName: method, args, value: 0n, fees: transactionFees(quote) });
  await finalize(client, hash, progress);
  return String(hash);
}
export async function deployChange(onProgress: Progress) {
  const progress: Progress = value => onProgress({ ...value, method: "deploy" });
  const { client } = await walletClient();
  progress({ label: "GenLayer is checking the contract code" });
  await deadline(client.getContractSchemaForCode(source), 90_000);
  progress({ label: "Estimating the deployment fee" });
  const quote = await deadline(client.estimateTransactionFees({ appealRounds: 1n, rotations: [1n, 1n] }));
  progress({ label: "Review the deployment in your wallet", fee: formatEther(quote.feeValue) });
  const hash = await client.deployContract({ code: new TextEncoder().encode(source), args: [], fees: transactionFees(quote) });
  const receipt = await finalize(client, hash, progress);
  const decoded = receipt.txDataDecoded;
  const rawAddress = (decoded && "contractAddress" in decoded ? decoded.contractAddress : undefined) || receipt.recipient || receipt.to_address;
  const address = typeof rawAddress === "string" ? rawAddress : "";
  if (!validAddress(address)) throw new Error("Deployment finalized but its address could not be read. Open the transaction to retrieve the contract address.");
  await verifyContract(address);
  return { address, hash: String(hash) };
}
export { downloadFile } from "../lib/download-file";
export async function auditPackage(address: string, id: string) {
  const record = await readCase(address, id);
  return {
    schema: "proofguard-change-audit/1.0", network: "GenLayer Studio Dev", chainId: studioDevnet.id,
    contract: address.toLowerCase(), contractSourceSha256: await sha256(source), readState: "LATEST_FINAL",
    observedAt: new Date().toISOString(), case: record,
    executionScope: "REGISTERED_JOB_RELEASED is a finalized contract queue record. External payments, orders and tools are not observed by this package.",
    verification: ["Read get_policy and getContractCode at the stated GenLayer address; compare policy and code hash.", "Read get_case(case.id) with LATEST_FINAL. Historical revisions, reviews and releases must match this package.", "Compute SHA-256 of each source.text and action.intent_json as exact UTF-8 bytes.", "Confirm each release binds the exact action hash and a reviewed revision. A later revision cannot undo an earlier release.", "This JSON snapshot is not a cryptographic chain proof; independently re-read GenLayer to verify it."],
  };
}
