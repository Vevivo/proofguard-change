import { sha256, toHex, toBytes, hashMessage, recoverPublicKey, recoverMessageAddress } from "viem";

const MAX_ARCHIVE_BYTES = 100_000;
export class ArchiveRejected extends Error {
  constructor(public status: number) {
    super(status === 402 ? "Turbo rejected the upload for insufficient credits. Top up the signing wallet in AR.IO Console, or download the package." : "Turbo rejected this upload. No archive record was accepted.");
    this.name = "ArchiveRejected";
  }
}
export type ArchivePublication = {
  uploadStatus?: "SUBMITTED" | "ACCEPTED"; quotedWinc?: string; signerAddress?: string; recordId: string; url: string; sha256: string; bytes: number; publishedAt: string;
  caseId: string; contract: string; revision: number;
  retrieval: "NOT_CHECKED" | "VERIFIED" | "UNAVAILABLE" | "MISMATCH";
  retrievalCheckedAt?: string;
  arweaveSettlement: "NOT_VERIFIED";
  services: { decision: string; upload: string; storage: string; access: string };
};

type ArchiveContext = { caseId: string; contract: string; revision: number };
export type ArchiveDraft = ArchiveContext & { text: string; sha256: string; bytes: number; estimatedSignedBytes: number; quotedWinc: string; preparedAt: string };
export type ArchiveWallet = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
async function turboClient() {
  const { TurboFactory } = await import("@ardrive/turbo-sdk/web");
  return TurboFactory.unauthenticated({ token: "ethereum", uploadServiceConfig: {
    retryConfig: { retries: 1, retryDelay: () => 0, onRetry: () => {} },
  } });
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Turbo pricing is unavailable. Prepare the archive again.")), 20000); })]); }
  finally { clearTimeout(timer); }
}
// Quotes are read-only. No wallet signature, upload or top-up occurs here.
export async function prepareAuditArchive(text: string, context: ArchiveContext): Promise<ArchiveDraft> {
  const bytes = new TextEncoder().encode(text);
  if (!bytes.length || bytes.length > MAX_ARCHIVE_BYTES) throw new Error("The package exceeds the 100 KB direct upload limit. Download a local copy.");
  const estimatedSignedBytes = bytes.length + 4096;
  const turbo = await turboClient();
  const [quote] = await bounded(turbo.getUploadCosts({ bytes: [estimatedSignedBytes] }));
  if (!quote || !/^\d+$/.test(quote.winc)) throw new Error("Turbo did not return a valid price. No upload was started.");
  return { ...context, text, sha256: sha256(bytes).slice(2), bytes: bytes.length, estimatedSignedBytes, quotedWinc: quote.winc, preparedAt: new Date().toISOString() };
}
// Sign an ANS-104 data item with the existing EVM wallet, then use Turbo SDK's
// signed upload route. Only existing Turbo credits can be spent: there is no
// token-transfer RPC, network switch, auto-funding or automatic POST retry.
export async function uploadAuditSnapshot(draft: ArchiveDraft, wallet: ArchiveWallet, onSubmit?: (publication: ArchivePublication) => void): Promise<ArchivePublication> {
  const bytes = new TextEncoder().encode(draft.text);
  if (bytes.length !== draft.bytes || bytes.length > MAX_ARCHIVE_BYTES || sha256(bytes).slice(2) !== draft.sha256) throw new Error("The prepared archive changed. Prepare it again.");
  if (!/^\d+$/.test(draft.quotedWinc) || Date.now() - Date.parse(draft.preparedAt) > 300000 || !Number.isFinite(Date.parse(draft.preparedAt))) throw new Error("The upload quote expired. Prepare the archive again.");
  const accounts = await wallet.request({ method: "eth_requestAccounts" });
  const address = Array.isArray(accounts) ? String(accounts[0]) : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("Select a wallet to sign this archive.");
  const [{ InjectedEthereumSigner, createData }, { Buffer }] = await Promise.all([import("@dha-team/arbundles"), import("buffer")]);
  const signMessage = async (value: string | Uint8Array | number[]) => {
    const message = typeof value === "string" ? value : { raw: new Uint8Array(value) };
    const encoded = typeof value === "string" ? toHex(value) : toHex(new Uint8Array(value));
    const signature = await wallet.request({ method: "personal_sign", params: [encoded, address] }) as `0x${string}`;
    if ((await recoverMessageAddress({ message, signature })).toLowerCase() !== address.toLowerCase()) throw new Error("The signing wallet changed. Prepare the archive again.");
    return signature;
  };
  const signer = new InjectedEthereumSigner({ getSigner: () => ({ signMessage }) });
  signer.setPublicKey = async () => {
    const message = "Connect your wallet to publish a ProofGuard audit with Turbo. This message does not authorize a token transfer.";
    const signature = await signMessage(message) as `0x${string}`;
    signer.publicKey = Buffer.from(toBytes(await recoverPublicKey({ hash: hashMessage(message), signature })));
  };
  await signer.setPublicKey();
  const item = createData(bytes, signer, { tags: [
    { name: "Content-Type", value: "application/json" }, { name: "App-Name", value: "ProofGuard-Change" },
    { name: "Case-ID", value: draft.caseId }, { name: "GenLayer-Contract", value: draft.contract },
    { name: "Source-Revision", value: String(draft.revision) }, { name: "SHA-256", value: draft.sha256 },
  ] });
  await item.sign(signer);
  const raw = Uint8Array.from(item.getRaw());
  const turbo = await turboClient();
  const [price] = await bounded(turbo.getUploadCosts({ bytes: [raw.length] }));
  if (!price || !/^\d+$/.test(price.winc) || BigInt(price.winc) > BigInt(draft.quotedWinc) || raw.length > draft.estimatedSignedBytes) throw new Error("The upload price changed. Prepare a new quote before publishing.");
  const publication: ArchivePublication = {
    caseId: draft.caseId, contract: draft.contract, revision: draft.revision,
    recordId: item.id, url: `https://turbo-gateway.com/${item.id}`, sha256: draft.sha256, bytes: bytes.length,
    publishedAt: new Date().toISOString(), uploadStatus: "SUBMITTED", quotedWinc: price.winc, signerAddress: address,
    retrieval: "NOT_CHECKED", arweaveSettlement: "NOT_VERIFIED",
    services: { decision: "GenLayer", upload: "Turbo SDK", storage: "Arweave", access: "AR.IO gateway" },
  };
  // The record ID is known before POST, allowing GET-only recovery if its reply is lost.
  onSubmit?.(publication);
  const uploaded = await turbo.uploadSignedDataItem({
    dataItemStreamFactory: () => new Blob([raw]).stream(), dataItemSizeFactory: () => raw.length,
    signal: AbortSignal.timeout(45000),
  }).catch((error: unknown) => {
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
    if ([400, 401, 402, 403, 413, 415, 422, 429].includes(status)) throw new ArchiveRejected(status);
    throw error;
  });
  if (uploaded.id !== item.id) throw new Error("Turbo returned a different record ID. Check retrieval of the signed record.");
  return { ...publication, uploadStatus: "ACCEPTED" };
}

// Compare the gateway's actual bytes; upload acceptance alone proves neither
// retrieval nor settlement on Arweave. A retrieval problem never uploads again.
export async function verifyArchiveRetrieval(publication: ArchivePublication): Promise<ArchivePublication> {
  const checked = { ...publication, retrievalCheckedAt: new Date().toISOString() };
  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(publication.recordId)) throw new Error("Invalid record ID");
    const response = await fetch(`https://turbo-gateway.com/${publication.recordId}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok || !response.body) throw new Error("Record unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > MAX_ARCHIVE_BYTES || length > publication.bytes) {
          await reader.cancel();
          return { ...checked, retrieval: "MISMATCH" };
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const actual = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { actual.set(chunk, offset); offset += chunk.length; }
    return { ...checked, retrieval: length === publication.bytes && sha256(actual).slice(2) === publication.sha256 ? "VERIFIED" : "MISMATCH" };
  } catch { return { ...checked, retrieval: "UNAVAILABLE" }; }
}
