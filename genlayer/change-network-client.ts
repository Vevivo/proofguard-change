import { addWalletNetwork, ensureWalletNetwork, requestWalletAccount } from "./wallet-network.mjs";
import { getAddress } from "viem";
import { requestWallet } from "./wallet-connection";
import { createClient } from "genlayer-studionet";
import { studionet } from "genlayer-studionet/chains";
import { TransactionHashVariant } from "genlayer-studionet/types";
import { trackSubmittedTransaction } from "./change-transaction.mjs";
import { deadline, sha256, validAddress, downloadFile } from "./change-client";
import source from "../contracts/genlayer/change_network.py?raw";
import legacySource from "../contracts/genlayer/archive/change_network_v2_legacy.py?raw";
export { sha256, validAddress, downloadFile };
export const NETWORK_POLICY = "proofguard-change/2.0";
export const NETWORK_SOURCE = source;
export const NETWORK_CHAIN = studionet;
export const NETWORK_EXPLORER = "https://explorer-studio.genlayer.com";
export type Verdict = "MATERIAL_CHANGE" | "NO_MATERIAL_CHANGE" | "INSUFFICIENT_EVIDENCE";
export type SourceVersion = { revision: number; text: string; sha256: string };
export type Permit = { id: string; revision: number; intent_hash: string; source_sha256: string; authorized_by: string };
export type Execution = { id: string; revision: number; permit_id: string; intent_hash: string; executor: string; effect: string; output_json: string; output_sha256: string; external_order: string; external_payment: string };
export type NetworkJob = { id: string; label: string; condition: string; intent_json: string; intent_hash: string; permits: Permit[]; execution: Execution | null; gate: string; active_permit: Permit | null };
export type NetworkReview = { revision: number; policy: string; source_sha256: string; actions: { workflow_id: string; id: string; verdict: Verdict; reason: string; old_quote: string; new_quote: string }[] };
export type NetworkWorkflow = { schema: string; id: string; title: string; owner: string; executor: string; source_id: string; baseline_revision: number; reviewed_revision: number; revision: number; actions: NetworkJob[]; reviews: NetworkReview[]; attempts: { index: number; action_id: string; operation: string; requested_revision: number; current_revision: number; intent_hash: string; code: string; actor: string; allowed: boolean }[] };
export type SourceBundle = { reviewEngine?: "indexed-excerpts" | "legacy-quotes"; schema: string; source: { id: string; title: string; publisher: string; revision: number; versions: SourceVersion[]; workflow_ids: string[]; approved_owners: string[]; review_batches: { revision: number; workflow_ids: string[]; requested_by: string }[] }; workflows: NetworkWorkflow[] };
export type NetworkProgress = { label: string; hash?: string; fee?: string; finalized?: boolean; recoverable?: boolean; failed?: boolean; contract?: string; caseId?: string; method?: string };
export type JobInput = { id: string; label: string; condition: string; tool: "prepare_purchase_order" | "prepare_price_report"; target: string; payload: { unit_price: number; currency: string; quantity?: number; shipping?: "express" | "standard" } };
export function networkReader() { return createClient({ chain: studionet }); }
async function inspectNetworkContract(address: string) {
  if (!validAddress(address)) throw new Error("Enter a valid Change Network contract address.");
  address = getAddress(address.toLowerCase());
  const client = networkReader();
  const [code, policy] = await deadline(Promise.all([
    client.getContractCode(address as `0x${string}`),
    client.readContract({ address: address as `0x${string}`, functionName: "get_policy", args: [], transactionHashVariant: TransactionHashVariant.LATEST_FINAL }),
  ]));
  if ((code !== source && code !== legacySource) || policy !== NETWORK_POLICY) throw new Error("This address is not the expected Change Network v2 contract on GenLayer Studionet. A v1 contract cannot be used here.");
  return { client, code, reviewEngine: code === source ? "indexed-excerpts" as const : "legacy-quotes" as const };
}
export async function verifyNetworkContract(address: string) { return (await inspectNetworkContract(address)).client; }
export async function readSourceBundle(address: string, id: string): Promise<SourceBundle> {
  const { client, reviewEngine } = await inspectNetworkContract(address);
  address = getAddress(address.toLowerCase());
  const raw = await deadline(client.readContract({ address: address as `0x${string}`, functionName: "get_source_bundle", args: [id], transactionHashVariant: TransactionHashVariant.LATEST_FINAL }));
  if (typeof raw !== "string") throw new Error("Unexpected source response.");
  const record = JSON.parse(raw) as SourceBundle;
  if (record.schema !== NETWORK_POLICY || record.source.id !== id || !Array.isArray(record.source.versions) || !record.source.versions.length || !Array.isArray(record.workflows) || record.workflows.length > 4) throw new Error("Source identity or schema does not match.");
  if (record.source.versions.length !== record.source.revision || record.workflows.length !== record.source.workflow_ids.length) throw new Error("Incomplete source history.");
  for (const v of record.source.versions) if (await sha256(v.text) !== v.sha256) throw new Error("Source integrity verification failed.");
  for (const w of record.workflows) {
    if (w.source_id !== id || !record.source.workflow_ids.includes(w.id) || w.revision !== record.source.revision) throw new Error("Workflow source binding does not match.");
    for (const a of w.actions) {
      if (await sha256(a.intent_json) !== a.intent_hash) throw new Error("Job intent integrity verification failed.");
      if (a.execution && await sha256(a.execution.output_json) !== a.execution.output_sha256) throw new Error("Output integrity verification failed.");
    }
  }
  return { ...record, reviewEngine };
}
export async function connectNetworkWallet() {
  const provider = await requestWallet();
  const account = await requestWalletAccount(provider);
  const client = createClient({ chain: studionet, account: account as `0x${string}`, provider: provider as never });
  await ensureWalletNetwork(provider, studionet);
  const confirmed = await provider.request({ method: "eth_accounts" }) as string[];
  if (confirmed[0]?.toLowerCase() !== account) throw new Error("The selected wallet changed during connection. Connect again before continuing.");
  return { client, account };
}
export async function addNetworkToWallet() {
  const provider = await requestWallet();
  await addWalletNetwork(provider, studionet);
  return connectNetworkWallet();
}
export async function resumeNetworkTransaction(hash: string, onProgress: (p: NetworkProgress) => void) {
  const client = networkReader();
  return trackSubmittedTransaction({ hash, onProgress, read: (h: string) => client.getTransaction({ hash: h as Parameters<typeof client.getTransaction>[0]["hash"] }) });
}
export async function writeNetwork(address: string, method: string, args: (string | bigint)[], onProgress: (p: NetworkProgress) => void, options: { expectedAccount?: string } = {}) {
  const progress = (p: NetworkProgress) => onProgress({ ...p, contract: address, caseId: String(args[0]), method });
  progress({ label: "Checking the contract before requesting wallet approval." });
  const inspection = await inspectNetworkContract(address);
  address = getAddress(address.toLowerCase());
  if (inspection.reviewEngine === "legacy-quotes") throw new Error("This contract uses the earlier review engine. Open its source and reuse the setup in an updated contract before sending more transactions. Existing records remain readable.");
  progress({ label: "Confirm your wallet connection if requested." });
  const { client, account } = await connectNetworkWallet();
  if (options.expectedAccount && account !== options.expectedAccount.toLowerCase()) throw new Error("The connected wallet does not match the owner named in this request. Select the expected owner and reconnect.");
  progress({ label: "Preparing the transaction. Confirm the request in your wallet when it opens." });
  const hash = await client.writeContract({ address: address as `0x${string}`, functionName: method, args, value: 0n });
  await resumeNetworkTransaction(String(hash), progress);
  return String(hash);
}
export async function deployNetwork(onProgress: (p: NetworkProgress) => void) {
  const progress = (p: NetworkProgress) => onProgress({ ...p, method: "deploy" });
  progress({ label: "Confirm your wallet connection if requested." });
  const { client } = await connectNetworkWallet();
  progress({ label: "Checking contract compatibility with GenLayer" });
  try {
    await deadline(client.getContractSchemaForCode(source), 90_000);
  } catch (cause) {
    throw new Error("GenLayer could not validate this contract. No deployment transaction was submitted. Open Technical details to inspect the network response.", { cause });
  }
  progress({ label: "Preparing deployment. Review the network fee in your wallet." });
  const hash = await client.deployContract({ code: new TextEncoder().encode(source), args: [] });
  const receipt = await resumeNetworkTransaction(String(hash), progress);
  const decoded = receipt.txDataDecoded;
  const address = String((decoded && "contractAddress" in decoded ? decoded.contractAddress : undefined) || receipt.recipient || receipt.to_address || "");
  await verifyNetworkContract(address);
  return { address, hash: String(hash) };
}
export async function networkAudit(address: string, id: string) {
  const bundle = await readSourceBundle(address, id);
  const { code } = await inspectNetworkContract(address);
  return { schema: "proofguard-change-network-audit/2.0", network: studionet.name, chainId: studionet.id, contract: address.toLowerCase(), contractSourceSha256: await sha256(code), readState: "LATEST_FINAL", observedAt: new Date().toISOString(), bundle,
    executionScope: "Guarded contract tools create purchase-order drafts or price reports. Artifact creation and permit consumption are atomic. External orders and payments are not submitted. Later revisions do not reverse existing artifacts.",
    verification: ["Independently compare getContractCode and get_policy with the expected policy and code hash.", "Read get_source_bundle(source.id) using LATEST_FINAL; compare source history, reviews, permits and outputs.", "Recompute SHA-256 from exact UTF-8 source.text, action.intent_json and execution.output_json bytes.", "Match each consumed permit to the source revision, intent, executor and generated artifact.", "This exported snapshot is not a cryptographic chain proof. Re-read the stated chain to verify it."] };
}
