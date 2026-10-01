export type EvidenceNetwork = "studionet" | "studio-next";
export type EvidenceConnection = { network: EvidenceNetwork; contract: string; sourceId: string };
export const EVIDENCE_NETWORKS = {
  studionet: { name: "Studionet", chainId: 61999, explorer: "https://explorer-studio.genlayer.com" },
  "studio-next": { name: "Studio Next", chainId: 61997, explorer: "https://explorer-studio-dev.genlayer.com" },
};
export const EVIDENCE_REFERENCES = [
  { id: "correction", name: "A correction stops an old approval", label: "Live test record · Studio Next", description: "Two delivery jobs, separate owner and executor. Inspect rejected old permits and the supported job's output. Fictional supplier terms.", network: "studio-next", contract: "0x8a93A27747D0a007cfD525D5456B1017ca5bF50e", sourceId: "CORRECTION-REGRESSION-01" },
  { id: "policy", name: "No training is not zero retention", label: "Live test record · Studionet", description: "One registered source supports a no-training condition but does not establish zero retention. A test of submitted text, not current GitHub policy.", network: "studionet", contract: "0x91883d4829E5b5bD7BED6eBd0EceF927A71942d6", sourceId: "COPILOT-BUSINESS-01" },
] as const;
export const V2_CODE_SHA256 = "beca7648cac048399221260c92f55bdc053301fe7eaa4611c3e6eecfc3c8e060";
export const PROOFGUARD_REPOSITORY = "https://github.com/Vevivo/proofguard-change";
export function evidenceUrl(connection: EvidenceConnection) {
  const params = new URLSearchParams({ mode: "inspect", network: connection.network, contract: connection.contract, source: connection.sourceId });
  return `./?${params}`;
}
