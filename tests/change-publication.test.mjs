import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { privateKeyToAccount } from "viem/accounts";
import { DataItem } from "@dha-team/arbundles";

// Build the real SDK and archive helper for the browser, with the same Vite
// configuration as ArNS. All HTTP is intercepted in this isolated test realm;
// no wallet, payment, live upload or actual browser session is used.
const root = fileURLToPath(new URL("../", import.meta.url));
const built = await build({
  root, configFile: `${root}vite.arns.config.ts`, publicDir: false, logLevel: "silent",
  build: { write: false, minify: false, lib: {
    entry: `${root}genlayer/change-publication.ts`, name: "ProofGuardArchive", formats: ["iife"],
  } },
});
const code = (Array.isArray(built) ? built[0] : built).output.find(item => item.type === "chunk").code;
function harness(fetch) {
  const sandbox = {
    fetch, console, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
    Request, Response, Headers, ReadableStream, TransformStream, AbortSignal,
    AbortController, Blob, File, Uint8Array, ArrayBuffer, DataView,
    crypto: webcrypto, navigator: { userAgent: "Chrome" }, document: {}, location: new URL("https://local-test.invalid/"),
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.ProofGuardArchive;
}
const text = JSON.stringify({ case: "Örnek denetim", decision: "GenLayer", actions: ["blocked", "queued"] });
const context = { caseId: "LOCAL-TEST", contract: `0x${"1".repeat(40)}`, revision: 2 };
const id = "T".repeat(43);

// Public, unfunded test key used only for isolated signing tests; never a user wallet.
const signer = privateKeyToAccount(`0x${"11".repeat(32)}`);
function wallet(log = []) {
  return { request: async ({ method, params }) => {
    log.push(method);
    if (method === "eth_requestAccounts") return [signer.address];
    if (method === "personal_sign") {
      assert.equal(params[1], signer.address);
      return signer.signMessage({ message: { raw: params[0] } });
    }
    throw new Error(`Unexpected wallet operation: ${method}`);
  } };
}

test("browser SDK signs exact audit bytes, uploads one valid ANS-104 item and verifies retrieval", async () => {
  const calls = [], methods = [], pending = [];
  const api = harness(async (url, init) => {
    calls.push({ url, init });
    if (String(url).includes("/price/bytes/")) return Response.json({ winc: "100" });
    if (init.method === "POST") {
      assert.equal(url, "https://upload.ardrive.io/v1/tx/ethereum");
      assert.equal(init.headers["x-turbo-source-identifier"], "turbo-sdk");
      const data = new DataItem(Buffer.from(await new Response(init.body).arrayBuffer()));
      assert.equal(await data.isValid(), true);
      assert.equal(Buffer.from(data.data, "base64url").toString("utf8"), text);
      assert.equal(data.tags.find(tag => tag.name === "GenLayer-Contract").value, context.contract);
      assert.equal(pending[0].recordId, data.id);
      return Response.json({ id: data.id });
    }
    assert.equal(url, pending[0].url);
    return new Response(text);
  });
  const draft = await api.prepareAuditArchive(text, context);
  assert.equal(calls.length, 1); // Preparation has no upload or wallet request.
  const publication = await api.uploadAuditSnapshot(draft, wallet(methods), item => pending.push(item));
  assert.equal(publication.sha256, createHash("sha256").update(text).digest("hex"));
  assert.equal(publication.uploadStatus, "ACCEPTED");
  assert.equal(publication.retrieval, "NOT_CHECKED");
  assert.deepEqual(methods, ["eth_requestAccounts", "personal_sign", "personal_sign"]);
  assert.equal((await api.verifyArchiveRetrieval(publication)).retrieval, "VERIFIED");
  assert.equal(publication.arweaveSettlement, "NOT_VERIFIED");
  assert.equal(calls.filter(call => call.init.method === "POST").length, 1);
});

test("gateway failures and altered bytes never become verified and never re-upload", async () => {
  let payload = "altered";
  let reads = 0;
  const api = harness(async (_url, init) => {
    assert.notEqual(init.method, "POST"); reads++;
    return payload === null ? new Response("pending", { status: 404 }) : new Response(payload);
  });
  const publication = { ...context, recordId: id, sha256: createHash("sha256").update(text).digest("hex"), bytes: Buffer.byteLength(text), retrieval: "NOT_CHECKED", arweaveSettlement: "NOT_VERIFIED" };
  assert.equal((await api.verifyArchiveRetrieval(publication)).retrieval, "MISMATCH");
  payload = null;
  assert.equal((await api.verifyArchiveRetrieval(publication)).retrieval, "UNAVAILABLE");
  payload = text;
  assert.equal((await api.verifyArchiveRetrieval(publication)).retrieval, "VERIFIED");
  assert.equal(reads, 3);
});

test("rejected uploads never retry, auto-fund, switch networks or send token transactions", async () => {
  for (const status of [402, 503]) {
    let posts = 0;
    const pending = [];
    const api = harness(async (url, init) => {
      if (String(url).includes("/price/bytes/")) return Response.json({ winc: "100" });
      assert.equal(init.method, "POST"); posts++;
      return new Response("upload rejected", { status });
    });
    const draft = await api.prepareAuditArchive(text, context);
    await assert.rejects(api.uploadAuditSnapshot(draft, wallet(), item => pending.push(item)));
    assert.equal(posts, 1);
    assert.match(pending[0].recordId, /^[A-Za-z0-9_-]{43}$/); // Can recover with a GET after a lost response.
  }
});

test("a changed or expired package cannot request a signature or upload", async () => {
  const api = harness(async () => Response.json({ winc: "100" }));
  const draft = await api.prepareAuditArchive(text, context);
  const noWallet = { request() { throw new Error("Wallet must not be called"); } };
  await assert.rejects(api.uploadAuditSnapshot({ ...draft, text: "changed" }, noWallet), /archive changed/);
  await assert.rejects(api.uploadAuditSnapshot({ ...draft, preparedAt: "2020-01-01" }, noWallet), /quote expired/);
});

test("a price increase or cancelled signature stops before the upload", async () => {
  let quotes = 0, posts = 0;
  const api = harness(async (_url, init) => {
    if (init.method === "POST") posts++;
    return Response.json({ winc: ++quotes === 1 ? "100" : "200" });
  });
  const draft = await api.prepareAuditArchive(text, context);
  await assert.rejects(api.uploadAuditSnapshot(draft, wallet()), /price changed/);
  assert.equal(posts, 0);
  const cancelled = { request: async ({method}) => {
    if (method === "eth_requestAccounts") return [signer.address];
    throw new Error("User rejected request");
  } };
  await assert.rejects(api.uploadAuditSnapshot(draft, cancelled), /User rejected/);
  assert.equal(posts, 0);
});
