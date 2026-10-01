import { sha256, toHex } from "viem";
import { createInspectorCore } from "./inspector-core.mjs";
import { EVIDENCE_NETWORKS, V2_CODE_SHA256, type EvidenceConnection } from "@/config/evidence-desk";
import type { SourceBundle } from "./change-network-client";

export type EvidenceSnapshot = {
  mode: "LIVE_FINALIZED_RPC_READ"; observedAt: string; chainId: number; contract: string;
  contractCodeSha256: string; boundary: string; bundle: SourceBundle;
  source: { id: string; title: string; publisher: string; revision: number; sha256: string };
};
export const browserSha256 = (text: string) => sha256(toHex(text)).slice(2);

export async function createBrowserInspector(connection: EvidenceConnection, onProgress: (phase: string) => void = () => {}, signal?: AbortSignal) {
  if (signal?.aborted) throw Error("READ_CANCELLED");
  onProgress("Connecting to the selected network");
  const client = connection.network === "studio-next"
    ? await Promise.all([import("genlayer-js"), import("genlayer-js/chains")]).then(([sdk, chains]) => sdk.createClient({ chain: chains.studioDevnet }))
    : await Promise.all([import("genlayer-studionet"), import("genlayer-studionet/chains")]).then(([sdk, chains]) => sdk.createClient({ chain: chains.studionet }));
  return createInspectorCore({ client, chainId: EVIDENCE_NETWORKS[connection.network].chainId, contract: connection.contract, sourceId: connection.sourceId, expectedCodeSha256: V2_CODE_SHA256, sha256: browserSha256, onProgress, signal });
}

export function inspectionError(error: unknown) {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "READ_FAILED";
  const messages: Record<string, string> = {
    READ_TIMEOUT: "The network did not complete the checks within 45 seconds. Retry this record, or choose another test record. No current result has been established.",
    READ_CANCELLED: "Read cancelled. No current result has been established.",
    RPC_READ_FAILED: "The record could not be read. Check the network, contract and Source ID, then retry. Test networks can be unavailable or reset.",
    CONTRACT_CODE_MISMATCH: "This contract does not match the supported ProofGuard v2 code. Check its address and network.",
    CHAIN_MISMATCH: "The RPC reported a different network. This result cannot be used.",
    STALE_SOURCE_REVISION: "The expected revision does not match the current source. Refresh the record and use its current revision before continuing.",
    OUTPUT_NOT_CREATED: "This job has no generated output. A held or unexecuted job cannot supply an artifact.",
  };
  return { code, message: messages[code] || "The record could not be verified. No usable result was returned. Check the technical code below before retrying." };
}
