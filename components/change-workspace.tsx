"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { TransactionHashVariant } from "genlayer-js/types";
import { ArrowUpRight, Check, ChevronRight, Copy, Download, FileText, Fingerprint, Gavel, Layers, LoaderCircle, LockKeyhole, RotateCcw, ShieldCheck, Upload, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { EXAMPLE_ACTIONS, SOURCE_BEFORE, SOURCE_CHANGED, SOURCE_WORDING } from "@/config/change-examples";
import { CHANGE_DEFAULT_CONTRACT } from "@/config/change-deployment";
import { LIVE_CASE_ID, LIVE_DECISION_TX, isReferenceCase } from "@/config/change-reference";
import { PUBLIC_APP_URL } from "@/config/public-site";
import { CHANGE_EXPLORER, CHANGE_SOURCE, auditPackage, deadline, deployChange, downloadFile, readCase, resumeChangeTransaction, verifyContract, walletClient, writeChange, type ChangeCase, type ChangeAction, type TxProgress } from "@/genlayer/change-client";
import { TransactionReadUnavailable } from "@/genlayer/change-transaction.mjs";
import { ArchiveRejected, prepareAuditArchive, uploadAuditSnapshot, verifyArchiveRetrieval, type ArchivePublication, type ArchiveDraft } from "@/genlayer/change-publication";
import { clearPending, readPending, rememberPending, readArchive, rememberArchive, clearArchive } from "@/genlayer/change-session.mjs";
import { readableAudit } from "@/genlayer/change-report.mjs";
import { confirmedBlock as findConfirmedBlock } from "@/genlayer/change-completion.mjs";

type Stage = "case" | "change" | "decision" | "record";
const steps: { id: Stage; label: string; detail: string; icon: typeof FileText }[] = [
  { id: "case", label: "Case", detail: "Source & jobs", icon: FileText },
  { id: "change", label: "Revision", detail: "Updated evidence", icon: Layers },
  { id: "decision", label: "Decision", detail: "Impact & permission", icon: Gavel },
  { id: "record", label: "Audit", detail: "Audit record", icon: Fingerprint },
];
const compact = (value: string) => value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
const statusLabel: Record<string, string> = { MATERIAL_CHANGE: "BLOCKED", NO_MATERIAL_CHANGE: "CAN CONTINUE", INSUFFICIENT_EVIDENCE: "INSUFFICIENT EVIDENCE", STALE_SOURCE_REVISION: "STALE REVISION REJECTED", INTENT_MISMATCH: "INTENT MISMATCH", ALREADY_RELEASED: "DUPLICATE REJECTED", AWAITING_REVIEW: "AWAITING REVIEW", READY: "JOB QUEUED" };

export function ChangeWorkspace() {
  const activeOperation = useRef(false);
  const progressRef = useRef<TxProgress | null>(null);
  const operationHash = useRef<string | null>(null);
  const [address, setAddress] = useState("");
  const [addressInput, setAddressInput] = useState(CHANGE_DEFAULT_CONTRACT);
  const [account, setAccount] = useState("");
  const [connected, setConnected] = useState(false);
  const [setup, setSetup] = useState(false);
  const [mode, setMode] = useState<"create" | "inspect">("inspect");
  const [stage, setStage] = useState<Stage>("case");
  const [caseId, setCaseId] = useState("");
  const [title, setTitle] = useState("Delivery promise, revised");
  const [source, setSource] = useState(SOURCE_BEFORE);
  const [revision, setRevision] = useState(SOURCE_CHANGED);
  const [publisher, setPublisher] = useState("");
  const [draftActions, setDraftActions] = useState(JSON.stringify(EXAMPLE_ACTIONS, null, 2));
  const [custom, setCustom] = useState(false);
  const [record, setRecord] = useState<ChangeCase | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "info">("success");
  const [progress, setProgress] = useState<TxProgress | null>(null);
  const [consent, setConsent] = useState(false);
  const [publication, setPublication] = useState<ArchivePublication | null>(null);
  const [archiveError, setArchiveError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [archiveDraft, setArchiveDraft] = useState<ArchiveDraft | null>(null);
  const [archiveUnknown, setArchiveUnknown] = useState(false);
  const [observedAt, setObservedAt] = useState("");
  const [technicalError, setTechnicalError] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [exportPrepared, setExportPrepared] = useState(false);

  const owner = !!record && account === record.owner.toLowerCase();
  const sourceOwner = !!record && account === record.publisher.toLowerCase();
  const currentReview = record?.reviewed_revision === record?.revision ? record?.reviews.at(-1) : undefined;
  const reference = isReferenceCase(address, record);
  const presentAction = (action: ChangeAction) => reference ? EXAMPLE_ACTIONS.find(example => example.id === action.id) || action : action;
  const unresolvedTransaction = !!progress?.hash && !progress.failed && (!progress.finalized || !!progress.recoverable);
  let previewActions: { id: string; label: string; condition: string }[] = [];
  let actionsError = "";
  try {
    const parsed: unknown = JSON.parse(draftActions);
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 3 || !parsed.every(action =>
      action && typeof action === "object" && ["id", "label", "condition", "tool", "target"].every(key => typeof action[key] === "string" && action[key].trim())
    )) throw new Error("Define one to three jobs. Each needs a text ID, label, condition, tool and target.");
    if (new Set(parsed.map(action => action.id)).size !== parsed.length) throw new Error("Use a unique ID for each job.");
    previewActions = parsed;
  } catch (caught) { actionsError = caught instanceof SyntaxError ? "The job JSON is incomplete. Check it in the editor." : caught instanceof Error ? caught.message : "Check the job definitions."; }

  async function run(work: () => Promise<void>) {
    if (activeOperation.current) return;
    activeOperation.current = true;
    operationHash.current = unresolvedTransaction ? progress?.hash || null : null;
    setBusy(true); setError(""); setTechnicalError(""); setNotice(""); setNoticeTone("success");
    try {
      await work();
      if (progressRef.current?.finalized && !progressRef.current.recoverable) {
        try { clearPending(localStorage, progressRef.current.hash); } catch { /* optional */ }
      }
    }
    catch (caught) {
      const message = caught instanceof Error ? caught.message : "The operation could not be completed.";
      const connectionLost = caught instanceof TransactionReadUnavailable || /failed to fetch|fetch failed|networkerror|http request failed|timed out|longer to respond/i.test(message);
      if (connectionLost && work !== publishAudit) {
        setNoticeTone("info");
        setNotice("The latest GenLayer result is temporarily unavailable. Check the submitted transaction again to recover its status.");
        setProgress(current => current?.hash && current.hash === operationHash.current ? { ...current, recoverable: true, label: current.finalized ? "Transaction finalized; the case still needs refreshing" : "Transaction submitted; its latest status is unavailable" } : current);
      } else if (/user rejected|user denied|rejected the request|4001/i.test(message)) {
        setNoticeTone("info"); setNotice("The wallet request was cancelled. No new transaction was submitted by this request.");
      } else {
        setError(/CASE_NOT_FOUND/.test(message) ? "This case was not found on the selected contract. Check the case ID or inspect the live example." : /RPC|viem@|ContractFunctionExecutionError|instanceof/i.test(message) ? "The request could not be completed. Your existing GenLayer records are preserved." : message);
        if (/RPC|viem@|ContractFunctionExecutionError|instanceof/i.test(message)) setTechnicalError(message);
      }
    }
    finally { activeOperation.current = false; setBusy(false); }
  }
  function trackProgress(value: TxProgress) {
    progressRef.current = value;
    if (value.hash) operationHash.current = value.hash;
    setProgress(value);
    try { rememberPending(localStorage, value); } catch { /* optional local recovery */ }
  }
  async function attach(contract: string) {
    setRecord(null); setConnected(false); setPublication(null); setArchiveUnknown(false); setArchiveError("");
    const client = await verifyContract(contract.trim());
    // The recent-case list is optional; its failure must not block known-case reads.
    const ids = await deadline(client.readContract({ address: contract.trim() as `0x${string}`, functionName: "list_cases", args: [], transactionHashVariant: TransactionHashVariant.LATEST_FINAL })).catch(() => []);
    setRecent(Array.isArray(ids) ? ids.map(String).reverse() : []);
    setAddress(contract.trim()); setAddressInput(contract.trim()); setConnected(true); setSetup(false);
    try { localStorage.setItem("proofguard-change-contract", contract.trim()); } catch { /* optional device preference */ }
    return contract.trim();
  }
  async function openCase(contract = address, id = caseId) {
    const value = await readCase(contract, id.trim());
    setRecord(value); setCaseId(value.id); setConsent(false); setArchiveError("");
    setArchiveDraft(null);
    setObservedAt(new Date().toISOString());
    setRevision(value.revision === 1 && value.sources[0].text === SOURCE_BEFORE ? SOURCE_CHANGED : value.sources.at(-1)?.text || "");
    setShareLink("");
    if (record?.id !== value.id || record?.revision !== value.revision) setExportPrepared(false);
    const localUrl = new URL(window.location.href);
    localUrl.searchParams.set("contract", contract); localUrl.searchParams.set("case", value.id);
    window.history.replaceState(null, "", localUrl);
    setPublication(current => current?.caseId === value.id && current.contract.toLowerCase() === contract.toLowerCase() && current.revision === value.revision ? current : null);
    try {
      const saved = readArchive(localStorage, contract, value.id, value.revision);
      setArchiveUnknown(saved?.status === "UNKNOWN");
      if (saved?.publication) setPublication(saved.publication);
    } catch { /* optional local recovery */ }
    setStage(value.reviews.length ? "decision" : "change");
    return value;
  }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let stored = "";
    try { stored = localStorage.getItem("proofguard-change-contract") || ""; } catch { /* optional */ }
    let pending: ReturnType<typeof readPending> = null;
    try { pending = readPending(localStorage); } catch { /* optional */ }
    const selected = pending?.contract || params.get("contract") || stored || CHANGE_DEFAULT_CONTRACT;
    const selectedCase = pending?.caseId || params.get("case") || "";
    setCaseId(selectedCase || LIVE_CASE_ID);
    if (pending) {
      const recovered = { ...pending, recoverable: true, label: "A submitted transaction was found on this device. Check its status to continue." };
      progressRef.current = recovered; setProgress(recovered);
    }
    if (selected) {
      setAddressInput(selected); setBusy(true);
      attach(selected).then(async current => { if (selectedCase && !pending) { setMode("inspect"); await openCase(current, selectedCase); } })
        .catch(caught => {
          const message = caught instanceof Error ? caught.message : "The contract could not be opened.";
          if (/failed to fetch|fetch failed|network|RPC|longer to respond/i.test(message)) {
            setNoticeTone("info"); setNotice("GenLayer could not be reached. Reconnect below to read verified cases.");
          } else setError(message);
          setSetup(true);
        })
        .finally(() => setBusy(false));
    }
    const changed = () => { setAccount(""); };
    window.ethereum?.on?.("accountsChanged", changed);
    window.ethereum?.on?.("chainChanged", changed);
    return () => { window.ethereum?.removeListener?.("accountsChanged", changed); window.ethereum?.removeListener?.("chainChanged", changed); };
    // Initial URL and device preference only; reads are never treated as cached chain state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [stage]);

  async function connectWallet() { const current = await walletClient(); setAccount(current.account); return current.account; }
  function requireResolvedTransaction() {
    if (unresolvedTransaction) throw new Error("Check the submitted transaction first. Recovery reads the same transaction without submitting it again.");
  }
  async function refreshCase() {
    const selectedStage = stage;
    const hadRecord = !!record;
    const recovering = !!progress?.hash && !progress.failed && (!progress.finalized || !!progress.recoverable);
    if (recovering && progress?.hash) {
      const context = progress;
      const receipt = await resumeChangeTransaction(progress.hash, value => trackProgress({ ...context, ...value, recoverable: !!value.recoverable }));
      if (receipt.type === 1) {
        await attach(receipt.recipient || receipt.to_address);
        setNotice("Deployment finalized. Connected to the deployed contract.");
        return;
      }
    }
    await openCase(recovering ? progress?.contract || address : address, recovering ? progress?.caseId || caseId : caseId);
    if (hadRecord) setStage(selectedStage);
    if (progressRef.current?.finalized) trackProgress({ ...progressRef.current, recoverable: false, label: "Finalized on GenLayer; case refreshed" });
    setNotice("The finalized GenLayer record has been refreshed.");
  }
  async function createCase() {
    requireResolvedTransaction();
    if (actionsError) throw new Error(actionsError);
    if (caseId.trim().length < 4 || title.trim().length < 2 || source.trim().length < 20) throw new Error("Use at least 4 characters for the case ID, 2 for the title and 20 for the source.");
    if (publisher.trim() && !/^0x[0-9a-fA-F]{40}$/.test(publisher.trim())) throw new Error("Enter a valid publisher wallet address or leave it empty.");
    const actor = await connectWallet();
    const actions = JSON.parse(draftActions);
    if (!Array.isArray(actions) || actions.length < 1 || actions.length > 3) throw new Error("Define one to three jobs.");
    await writeChange(address, "create_case", [caseId.trim(), title.trim(), publisher.trim() || actor, source, JSON.stringify(actions)], trackProgress);
    await openCase(); setStage("change");
  }
  async function changeSource() {
    requireResolvedTransaction();
    if (!record) return;
    await writeChange(address, "revise_source", [record.id, BigInt(record.revision), revision], trackProgress);
    await openCase(); setStage("decision");
  }
  async function judge() {
    requireResolvedTransaction();
    if (!record) return;
    await writeChange(address, "adjudicate", [record.id, BigInt(record.revision)], trackProgress);
    await openCase(); setStage("decision");
  }
  async function release(action: ChangeAction, old = false, changed = false, repeatTest = false) {
    requireResolvedTransaction();
    if (!record) return;
    // A second tab may have completed a job since this screen was loaded.
    // Re-read before requesting a signature; explicit negative tests opt in.
    if (!old && !changed && !repeatTest) {
      const latest = await readCase(address, record.id);
      const currentAction = latest.actions.find(item => item.id === action.id);
      if (currentAction && (currentAction.release || findConfirmedBlock(latest, currentAction))) {
        await openCase(); setNotice("This job check is already recorded on GenLayer. No new signature or transaction is needed."); return;
      }
      if (latest.revision !== record.revision || latest.reviewed_revision !== latest.revision) {
        await openCase(); throw new Error("The source or review changed. Inspect the current decision before checking this job.");
      }
    }
    await writeChange(address, "release_action", [record.id, action.id, BigInt(old ? Math.max(0, record.revision - 1) : record.revision), changed ? "0".repeat(64) : action.intent_hash], trackProgress);
    const updated = await openCase();
    const attempt = updated.attempts.at(-1);
    setNotice(attempt ? (statusLabel[attempt.code] || attempt.code) : "The latest record has been refreshed.");
  }
  async function downloadAudit() {
    if (!record) return;
    const audit = await auditPackage(address, record.id);
    downloadFile(`${record.id}-audit.json`, JSON.stringify(audit, null, 2));
    setExportPrepared(true);
    setNotice("GenLayer was read again. Your full audit package has been downloaded.");
  }
  async function downloadReport() {
    if (!record) return;
    const audit = await auditPackage(address, record.id);
    downloadFile(`${record.id}-audit-report.html`, readableAudit(audit), "text/html");
    setExportPrepared(true);
    setNotice("Your readable report has been downloaded. Open it in a browser to read or print it as a PDF.");
  }
  async function prepareArchive() {
    if (!record || !currentReview) return;
    setArchiveError(""); setConsent(false); setArchiveDraft(null);
    try {
      const audit = await auditPackage(address, record.id);
      if (audit.case.revision !== record.revision || audit.case.reviewed_revision !== audit.case.revision) throw new Error("Refresh the case and inspect its latest decision first.");
      setArchiveDraft(await prepareAuditArchive(JSON.stringify(audit, null, 2), { caseId: record.id, contract: address, revision: record.revision }));
    } catch (caught) { setArchiveError(caught instanceof Error && !/RPC|viem@|Failed request|fetch|network/i.test(caught.message) ? caught.message : "The current archive or Turbo price could not be read. No upload was started. Try again."); }
  }
  async function publishAudit() {
    requireResolvedTransaction();
    if (!record || !consent || publication || archiveUnknown || !archiveDraft) return;
    setArchiveError(""); setPublishing(true);
    let sourceRead = false;
    let submitted = false;
    try {
      const audit = await auditPackage(address, record.id);
      if (audit.case.revision !== record.revision || audit.case.reviewed_revision !== audit.case.revision || JSON.stringify(audit.case) !== JSON.stringify(JSON.parse(archiveDraft.text).case)) {
        setArchiveDraft(null); setConsent(false); throw new Error("ARCHIVE_SOURCE_CHANGED");
      }
      sourceRead = true;
      if (!window.ethereum) throw new Error("Open MetaMask or a compatible wallet to sign the archive.");
      const context = { caseId: record.id, contract: address, revision: record.revision };
      const published = await uploadAuditSnapshot(archiveDraft, window.ethereum, pending => {
        submitted = true;
        try { rememberArchive(localStorage, { ...context, status: "SUBMITTING", publication: pending }); } catch { /* optional */ }
        setPublication(pending);
        setArchiveUnknown(true);
      });
      try { rememberArchive(localStorage, { ...context, status: "ACCEPTED", publication: published }); } catch { /* optional */ }
      setArchiveUnknown(false);
      setPublication(published);
      setPublication(await verifyArchiveRetrieval(published));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      if (caught instanceof ArchiveRejected) {
        try { clearArchive(localStorage, address, record.id, record.revision); } catch { /* optional */ }
        setArchiveUnknown(false); setPublication(null);
      }
      setArchiveError(caught instanceof ArchiveRejected ? caught.message : message === "ARCHIVE_SOURCE_CHANGED" ? "The source revision changed or is awaiting review. Refresh this case and inspect its latest decision before publishing." : !sourceRead ? "Publication was not started because GenLayer could not be read again. Try when the connection recovers."
        : !submitted ? /rejected|denied|4001/i.test(message) ? "Wallet signing was cancelled. The package was not uploaded." : message || "The upload did not start. Prepare the archive again."
        : /instanceof|not defined|dynamically imported module/i.test(message)
        ? "The archive uploader could not start. Your GenLayer record is intact; you can still download the audit package."
        : "The upload result is unknown. Your GenLayer record is intact. Verify the archive status before uploading again.");
    } finally { setPublishing(false); }
  }
  async function checkArchive() {
    if (publication) {
      const checked = await verifyArchiveRetrieval(publication);
      setPublication(checked);
      if (checked.retrieval === "VERIFIED") {
        setArchiveUnknown(false); setArchiveError("");
        try { rememberArchive(localStorage, { contract: address, caseId: checked.caseId, revision: checked.revision, status: "ACCEPTED", publication: checked }); } catch { /* optional */ }
      }
    }
  }
  async function copyLink() {
    if (!record) return;
    const url = new URL(PUBLIC_APP_URL); url.searchParams.set("contract", address); url.searchParams.set("case", record.id);
    setShareLink(url.toString());
    try { await navigator.clipboard.writeText(url.toString()); setNotice("Case link copied."); }
    catch { setNotice("Select and copy the case link below."); }
  }
  const actionState = (action: ChangeAction) => action.release ? "RELEASED" : currentReview?.actions.find(row => row.id === action.id)?.verdict || "PENDING";
  const blockFor = (action: ChangeAction) => findConfirmedBlock(record, action);
  const completedChecks = record?.actions.filter(action => action.release || blockFor(action)).length || 0;
  const stageDone = (id: Stage) => id === "case" ? !!record : id === "change" ? !!record && record.revision > 1 : id === "decision" ? !!currentReview && completedChecks === record?.actions.length : exportPrepared || publication?.retrieval === "VERIFIED";
  async function inspectReference() {
    requireResolvedTransaction();
    const selected = await attach(CHANGE_DEFAULT_CONTRACT);
    await openCase(selected, LIVE_CASE_ID);
    setMode("inspect");
  }
  function startCase() {
    if (unresolvedTransaction) return;
    if (progressRef.current?.finalized) {
      try { clearPending(localStorage, progressRef.current.hash); } catch { /* optional */ }
    }
    setRecord(null); setPublication(null); setArchiveUnknown(false); setStage("case"); setMode("create");
    setCaseId(`PGC-${Date.now().toString(36).toUpperCase()}`); setProgress(null); progressRef.current = null; setError(""); setNotice("");
    setShareLink(""); setExportPrepared(false); setArchiveDraft(null);
    const localUrl = new URL(window.location.href); localUrl.searchParams.delete("case"); window.history.replaceState(null, "", localUrl);
  }

  return <div className="pgc-app">
    <header className="pgc-header">
      <a className="pgc-brand" href="#"><span className="pgc-emblem"><ShieldCheck aria-hidden="true" /></span><span>ProofGuard<span className="pgc-product">CHANGE</span></span></a>
      <div className="pgc-header-actions"><span className="pgc-network">GenLayer Studio Dev</span><Button variant="outline" className="pgc-button" disabled={busy} onClick={() => run(async () => { await connectWallet(); })}><Wallet size={16} />{account ? compact(account) : "Connect wallet"}</Button></div>
    </header>
    <div className="pgc-layout">
      <aside className="pgc-sidebar"><span className="pgc-rail-title">DECISION FILE</span><nav aria-label="Case stages">{steps.map((step, index) => <Button key={step.id} variant="ghost" className={`pgc-step ${stage === step.id ? "is-active" : ""} ${stageDone(step.id) ? "is-complete" : ""}`} aria-label={`${step.label}${stageDone(step.id) ? ": complete" : ""}`} aria-current={stage === step.id ? "step" : undefined} disabled={busy || (!record && step.id !== "case")} onClick={() => setStage(step.id)}><span className="pgc-step-number">{stageDone(step.id) ? <Check size={15} aria-hidden="true" /> : `0${index + 1}`}</span><span className="pgc-step-text"><span>{step.label}</span><small>{step.detail}</small></span></Button>)}</nav><div className="pgc-rail-bottom"><LockKeyhole size={18} /><span>Every permission binds one exact job to a reviewed source revision.</span></div></aside>
      <main className="pgc-main">
        <div className="pgc-heading"><div><span className="pgc-eyebrow">WHEN THE FACTS CHANGE</span><h1>Which jobs can still go ahead?</h1><p>One corrected promise. Three agent jobs. Let GenLayer judge what changed, block affected jobs and release the ones that still qualify.</p></div><Button variant="ghost" className="pgc-connection" disabled={busy || unresolvedTransaction} onClick={() => setSetup(!setup)}><span className={connected ? "pgc-dot connected" : "pgc-dot"} />{connected ? "Contract verified" : "Checking connection"}<ChevronRight size={16} /></Button></div>

        {setup && <section className="pgc-setup" aria-label="GenLayer connection"><div><h2>{connected ? "Contract connection" : "Connect a GenLayer workspace"}</h2><p>This workspace is connected to a ProofGuard Change contract. Anyone with its address can read finalized cases without a wallet.</p></div><div className="pgc-input-action"><Input aria-label="Change contract address" value={addressInput} onChange={e => setAddressInput(e.target.value)} placeholder="Existing Change contract: 0x…" disabled={busy} /><Button className="pgc-button" disabled={busy || unresolvedTransaction || !addressInput} onClick={() => run(async () => { await attach(addressInput); })}>Connect</Button></div><div className="pgc-inline"><Button className="pgc-button primary" disabled={busy || unresolvedTransaction} onClick={() => run(async () => { requireResolvedTransaction(); const result = await deployChange(trackProgress); await attach(result.address); await connectWallet(); startCase(); setNotice("Your contract is deployed. You can now register a case."); })}>Deploy a new contract <ArrowUpRight size={16} /></Button><Button variant="ghost" className="pgc-button" disabled={busy} onClick={() => downloadFile("proofguard-change.py", CHANGE_SOURCE, "text/x-python")}><Download size={16} />Contract source</Button><small>Deployment uses testnet GEN. Review the fee in your wallet before signing.</small></div></section>}

        {error && <div role="alert" className="pgc-error"><div>{error}{technicalError && <details><summary>Technical details</summary><pre>{technicalError}</pre></details>}</div></div>}
        {notice && <div role="status" className={noticeTone === "info" ? "pgc-progress" : "pgc-notice"}>{noticeTone === "info" ? <RotateCcw size={17} /> : <Check size={17} />}{notice}</div>}
        {shareLink && <div className="pgc-share"><Label htmlFor="pgc-share-url">Share this case</Label><Input id="pgc-share-url" value={shareLink} readOnly onFocus={event => event.target.select()} /><small>Recipients can inspect the finalized record without a wallet.</small></div>}
        {progress && <div className="pgc-progress" aria-live="polite">{busy ? <LoaderCircle className="pgc-spin" size={18} /> : <Fingerprint size={18} />}<span>{progress.label}{progress.fee && <small> Estimated GEN: {progress.fee}</small>}</span>{progress.hash && progress.recoverable && <Button variant="outline" className="pgc-button" disabled={busy} onClick={() => run(refreshCase)}><RotateCcw size={16} />Check submitted transaction</Button>}{progress.hash && <a href={`${CHANGE_EXPLORER}/tx/${progress.hash}`} target="_blank" rel="noreferrer">View transaction <ArrowUpRight size={14} /></a>}</div>}

        {stage === "case" && !record && <section className="pgc-sheet"><div className="pgc-tabbar"><Button variant="ghost" className={mode === "create" ? "selected" : ""} aria-pressed={mode === "create"} disabled={busy || unresolvedTransaction} onClick={startCase}>Create a case</Button><Button variant="ghost" className={mode === "inspect" ? "selected" : ""} aria-pressed={mode === "inspect"} disabled={busy} onClick={() => setMode("inspect")}>Inspect a live case</Button></div>
          {mode === "inspect" ? <div className="pgc-section"><div className="pgc-live-entry"><span className="pgc-eyebrow">START WITH THE RECORDED EXAMPLE</span><h2>Delivery, or just dispatch?</h2><p>An agent planned three jobs using a supplier’s delivery promise. The supplier corrected one sentence. Should every job stop?</p><div className="pgc-mini-evidence"><div><span>THE ORIGINAL PROMISE</span><p>“Arrives the next business day.”</p></div><div><span>THE CORRECTION</span><p>“Dispatched the next business day.”</p></div></div><div className="pgc-inline"><Button className="pgc-button primary" disabled={busy || unresolvedTransaction} onClick={() => run(inspectReference)}>{busy ? <LoaderCircle className="pgc-spin" size={17} /> : <Fingerprint size={17} />}Inspect live decision <ChevronRight size={17} /></Button><span className="pgc-entry-note">No wallet. No transaction fee.</span></div><small>Fictional business scenario · real GenLayer contract records. Results load from the network when you open the case.</small></div><details className="pgc-open-existing"><summary>Open a different case</summary><p>Read any finalized case on this contract. No wallet needed.</p><Label htmlFor="pgc-inspect-id">Case ID</Label><div className="pgc-input-action"><Input id="pgc-inspect-id" value={caseId} onChange={e => setCaseId(e.target.value)} disabled={busy} /><Button className="pgc-button primary" disabled={busy || unresolvedTransaction || !connected || !caseId} onClick={() => run(async () => { await openCase(); })}>Open case</Button></div>{recent.length > 0 && <div className="pgc-recent"><span>Recent cases</span>{recent.slice(0, 8).map(id => <Button key={id} variant="ghost" disabled={busy || unresolvedTransaction} onClick={() => run(async () => { await openCase(address, id); })}>{id}<ArrowUpRight size={14} /></Button>)}</div>}</details></div> : <>
            <div className="pgc-section"><div className="pgc-section-title"><span className="pgc-number">01</span><div><h2>One source. The jobs that depend on it.</h2><p>Start with this fictional delivery example, or enter your own evidence and job conditions. You will register it on GenLayer before submitting a revision.</p></div></div><div className="pgc-fields"><div><Label htmlFor="pgc-case-id">Case ID</Label><Input id="pgc-case-id" value={caseId} maxLength={80} onChange={e => setCaseId(e.target.value)} disabled={busy} /></div><div><Label htmlFor="pgc-title">Case title</Label><Input id="pgc-title" value={title} maxLength={160} onChange={e => setTitle(e.target.value)} disabled={busy} /></div></div><Label htmlFor="pgc-source">Source text used by these jobs</Label><Textarea id="pgc-source" className="pgc-source-input" value={source} onChange={e => setSource(e.target.value)} maxLength={8192} disabled={busy} /></div>
            <div className="pgc-section pgc-actions-preview"><div className="pgc-inline spread"><h3>Jobs to register</h3><Button variant="ghost" disabled={busy} onClick={() => setCustom(!custom)}>{custom ? "Show summary" : "Edit job definitions"}</Button></div>{actionsError && <p role="alert" className="pgc-error">{actionsError}</p>}{!custom ? previewActions.map((action, i) => <div className="pgc-intent" key={action.id}><span>0{i + 1}</span><div><h3>{action.label}</h3><p>{action.condition}</p></div><span className="pgc-state neutral">DRAFT</span></div>) : <><Label htmlFor="pgc-actions">Jobs: ID, condition, tool, target and payload</Label><Textarea id="pgc-actions" className="pgc-code-input" value={draftActions} onChange={e => setDraftActions(e.target.value)} disabled={busy} /><Label htmlFor="pgc-publisher">Source publisher wallet</Label><Input id="pgc-publisher" value={publisher} onChange={e => setPublisher(e.target.value)} placeholder="Leave empty to use the connected wallet" disabled={busy} /></>}</div>
            <div className="pgc-bottom"><p>The source and job parameters become public on GenLayer. A wallet signature and testnet GEN are required.</p><Button className="pgc-button primary" disabled={busy || unresolvedTransaction || !connected || !!actionsError || !caseId.trim() || !title.trim() || !source.trim()} onClick={() => run(createCase)}>Register case on GenLayer <ChevronRight size={17} /></Button></div>
          </>}
        </section>}

        {record && <><div className="pgc-casebar"><div><span>{record.id}</span><h2>{reference ? "Delivery promise, revised" : record.title}</h2></div><div className="pgc-inline"><span className="pgc-version">SOURCE v{record.revision}</span><Button variant="ghost" disabled={busy} onClick={() => run(refreshCase)} aria-label="Refresh GenLayer record"><RotateCcw size={17} /></Button><Button variant="ghost" disabled={busy} onClick={() => run(copyLink)} aria-label="Copy case link"><Copy size={17} /></Button></div></div>
          <div className="pgc-read-context"><span><Check size={14} /> Read from finalized GenLayer state{observedAt && <> · <time dateTime={observedAt}>{new Date(observedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC</time></>}</span>{reference && <a href={`${CHANGE_EXPLORER}/tx/${LIVE_DECISION_TX}`} target="_blank" rel="noreferrer">Decision transaction <ArrowUpRight size={14} /></a>}</div>
          {reference && <p className="pgc-reference-note">This live example was recorded in Turkish. English summaries help explain it; original evidence and validator reasoning remain available below.</p>}
          {stage === "decision" && <div className="pgc-next-step"><div><span className="pgc-eyebrow">{completedChecks === record.actions.length ? "CHECKS COMPLETE" : currentReview ? "DECISION READY" : "NEXT STEP"}</span><h3>{completedChecks === record.actions.length ? "Your audit record is ready to inspect." : currentReview ? "Apply the decision to each registered job." : "Ask GenLayer to review this revision."}</h3><p>{completedChecks === record.actions.length ? "Review the evidence, decisions and queue records, then download or archive the package." : !owner ? "You are reading this case. Only its owner can submit job checks; anyone can inspect the recorded result." : "Confirm a blocked job or queue a qualifying job. Completed checks will be marked automatically."}</p></div>{currentReview && <Button className="pgc-button primary" disabled={busy} onClick={() => setStage("record")}>Open audit record <ChevronRight size={16} /></Button>}</div>}
          {stage === "change" && !sourceOwner && <p className="pgc-reference-note">Reading this case is open to everyone. Registering a revision requires its publisher’s wallet.</p>}
          {stage === "case" && <section className="pgc-sheet"><div className="pgc-section"><h2>Registered evidence</h2><EvidenceText text={record.sources[0].text} translation={reference ? SOURCE_BEFORE : undefined} /><p>Case owner: <code>{compact(record.owner)}</code> · Source publisher: <code>{compact(record.publisher)}</code></p></div><div className="pgc-section">{record.actions.map(action => <div className="pgc-intent" key={action.id}><FileText size={18} /><div><h3>{presentAction(action).label}</h3><p>{presentAction(action).condition}</p><details><summary>Exact job intent</summary><pre>{action.intent_json}</pre><code>{action.intent_hash}</code></details></div></div>)}</div><div className="pgc-bottom"><span>Job conditions and parameters are fixed for this case.</span><Button className="pgc-button primary" onClick={() => setStage("change")}>Review a source revision <ChevronRight size={17} /></Button></div></section>}

          {stage === "change" && <section className="pgc-sheet"><div className="pgc-section"><div className="pgc-section-title"><span className="pgc-number">02</span><div><h2>What changed in the source?</h2><p>Only the registered publisher can submit a revision. Jobs not yet queued must wait for the new revision to be reviewed.</p></div></div><div className="pgc-evidence-columns"><div><span className="pgc-label">LATEST REGISTERED TEXT · v{record.revision}</span><EvidenceText text={record.sources.at(-1)?.text || ""} translation={reference ? SOURCE_CHANGED : undefined} /></div><div><Label htmlFor="pgc-revision">REVISED SOURCE TEXT</Label><Textarea id="pgc-revision" value={revision} onChange={e => setRevision(e.target.value)} maxLength={8192} disabled={busy} /></div></div>{(record.sources[0].text === SOURCE_BEFORE || reference) && <div className="pgc-inline"><span>Example revision of the original promise:</span><Button variant="outline" disabled={busy} onClick={() => setRevision(SOURCE_CHANGED)}>Delivery promise changes</Button><Button variant="outline" disabled={busy} onClick={() => setRevision(SOURCE_WORDING)}>{record.revision === 1 ? "Wording changes only" : "Original promise, reworded"}</Button></div>}</div><div className="pgc-bottom"><p>Earlier revisions and decisions stay in the record.</p><div className="pgc-inline">{!account && <Button variant="outline" disabled={busy} onClick={() => run(async () => { await connectWallet(); })}>Connect wallet</Button>}<Button className="pgc-button primary" disabled={busy || unresolvedTransaction || !sourceOwner || !revision.trim() || revision.trim() === record.sources.at(-1)?.text || record.revision >= 8} onClick={() => run(changeSource)}>Register revision <ChevronRight size={17} /></Button></div></div></section>}

          {stage === "decision" && <section className="pgc-sheet"><div className="pgc-section"><div className="pgc-section-title"><span className="pgc-number">03</span><div><h2>Which conditions does the revision affect?</h2><p>GenLayer evaluates each job against both the original and current source. These results are read from finalized contract state.</p></div></div><div className="pgc-evidence-columns"><div><span className="pgc-label">ORIGINAL EVIDENCE</span><EvidenceText text={record.sources[0].text} translation={reference ? SOURCE_BEFORE : undefined} /></div><div><span className="pgc-label">CURRENT EVIDENCE · v{record.revision}</span><EvidenceText text={record.sources.at(-1)?.text || ""} translation={reference ? SOURCE_CHANGED : undefined} /></div></div>{!currentReview && <div className="pgc-decision-call"><div><h3>This revision needs a decision.</h3><p>Request a GenLayer review to evaluate the registered jobs.</p></div><div className="pgc-inline">{!account && <Button variant="outline" disabled={busy} onClick={() => run(async () => { await connectWallet(); })}>Connect wallet</Button>}<Button className="pgc-button primary" disabled={busy || unresolvedTransaction || !owner} onClick={() => run(judge)}><Gavel size={17} />Request GenLayer review</Button></div></div>}</div>
            <div className="pgc-section pgc-decisions">{record.actions.map(action => {
              const row = currentReview?.actions.find(r => r.id === action.id);
              const state = actionState(action);
              // Only a finalized, exact-intent attempt for this reviewed revision
              // confirms the main check. Old-version and wrong-hash tests do not.
              const confirmedBlock = blockFor(action);
              const completed = !!action.release || !!confirmedBlock;
              return <article key={action.id} className="pgc-decision-row">
                <div className="pgc-inline spread"><h3>{presentAction(action).label}</h3><span className={`pgc-state ${state === "RELEASED" || state === "NO_MATERIAL_CHANGE" ? "allow" : state === "MATERIAL_CHANGE" ? "hold" : "neutral"}`}>{state === "RELEASED" ? "QUEUED" : statusLabel[state] || "AWAITING REVIEW"}</span></div>
                <p>{presentAction(action).condition}</p>
                {reference && <details className="pgc-original"><summary>Original registered condition · Turkish</summary><p lang="tr">{action.label} — {action.condition}</p></details>}
                {row && <div className="pgc-reason"><span>GENLAYER REASONING</span>{reference ? <><p>{row.verdict === "MATERIAL_CHANGE" ? "The revised promise no longer supports this job’s condition." : row.verdict === "NO_MATERIAL_CHANGE" ? "This job’s registered condition still holds after the revision." : "The evidence is insufficient to release this job."}</p><details><summary>Read the recorded reasoning and quote · Turkish</summary><p lang="tr">{row.reason}</p>{row.new_quote && <blockquote lang="tr">“{row.new_quote}”</blockquote>}</details></> : <><p>{row.reason}</p>{row.new_quote && <blockquote>“{row.new_quote}”</blockquote>}</>}</div>}
                {action.release && <p className="pgc-release"><Check size={17} aria-hidden="true" /> <strong>Job queued.</strong> v{action.release.revision} decision recorded. This is a contract queue entry; external payment or delivery is not observed.</p>}
                {confirmedBlock && <p className="pgc-release"><Check size={17} aria-hidden="true" /> <strong>Block confirmed.</strong> Source v{record.revision} · record #{confirmedBlock.index}. This check is complete. No further signature is needed.</p>}
                <div className="pgc-inline">
                  <Button variant="outline" className="pgc-button" disabled={busy || unresolvedTransaction || !owner || !currentReview || completed} onClick={() => run(() => release(action))}>
                    {completed ? <><Check size={16} />{action.release ? "Queued" : "Block confirmed"}</> : <>{row?.verdict === "NO_MATERIAL_CHANGE" ? "Queue job" : "Confirm block on-chain"}<ChevronRight size={16} /></>}
                  </Button>
                  {owner && <details className="pgc-guard-checks"><summary>Advanced permission tests</summary><div className="pgc-inline"><Button variant="ghost" disabled={busy || unresolvedTransaction || !owner} onClick={() => run(() => release(action, true))}>Try an old revision</Button><Button variant="ghost" disabled={busy || unresolvedTransaction || !owner} onClick={() => run(() => release(action, false, true))}>Try a different intent</Button>{action.release && <Button variant="ghost" disabled={busy || unresolvedTransaction || !owner} onClick={() => run(() => release(action, false, false, true))}>Test duplicate prevention</Button>}</div><small>These optional tests also require signed GenLayer transactions and GEN fees. Each attempt is recorded.</small></details>}
                </div>
              </article>;
            })}</div><div className="pgc-bottom"><span><strong>{completedChecks} of {record.actions.length} job checks complete.</strong><br />{completedChecks === record.actions.length ? "The next step is your audit record." : "Each completed check stays visible after refresh."}</span><Button className="pgc-button primary" onClick={() => setStage("record")}>Open audit record <ChevronRight size={17} /></Button></div></section>}

          {stage === "record" && <section className="pgc-sheet"><div className="pgc-section"><div className="pgc-section-title"><span className="pgc-number">04</span><div><h2>What changed. What was decided. What happened.</h2><p>Source revisions, job conditions, GenLayer decisions and queue attempts, together in one audit package.</p></div></div><div className="pgc-audit-totals"><div><strong>{record.sources.length}</strong><span>Source revisions</span></div><div><strong>{record.reviews.length}</strong><span>Decision records</span></div><div><strong>{record.actions.filter(a => a.release).length}</strong><span>Jobs queued</span></div></div>{record.attempts.length ? <div className="pgc-attempts">{record.attempts.map(attempt => <div key={attempt.index}><span>#{attempt.index} · {attempt.action_id}</span><strong>{statusLabel[attempt.code] || attempt.code}</strong><span>Requested v{attempt.requested_revision} / current v{attempt.current_revision}</span></div>)}</div> : <p>No permission checks have been recorded yet. Open the decision stage to check a job.</p>}</div><div className="pgc-section"><div className="pgc-inline"><Button className="pgc-button primary" disabled={busy || !record.reviews.length} onClick={() => run(downloadAudit)}><Download size={17} />Download audit JSON</Button><Button variant="outline" className="pgc-button" disabled={busy || !record.reviews.length} onClick={() => run(downloadReport)}><FileText size={17} />Download readable report</Button><Button variant="outline" className="pgc-button" disabled={busy} onClick={() => run(copyLink)}><Copy size={16} />Share case</Button></div><details className="pgc-audit-details"><summary>Inspect the complete audit trail</summary><h3>Source revisions</h3>{record.sources.map(item => <div className="pgc-audit-entry" key={item.revision}><span className="pgc-label">REVISION {item.revision}</span><blockquote>{item.text}</blockquote><code>SHA-256: {item.sha256}</code></div>)}<h3>GenLayer reviews</h3>{record.reviews.map(review => <div className="pgc-audit-entry" key={review.revision}><span className="pgc-label">SOURCE v{review.revision} · {review.policy}</span>{review.actions.map(row => <div key={row.id}><h4>{row.id} · {statusLabel[row.verdict]}</h4><p>{row.reason}</p><blockquote>{row.old_quote}</blockquote><blockquote>{row.new_quote}</blockquote></div>)}</div>)}<h3>Registered job intents</h3>{record.actions.map(action => <div className="pgc-audit-entry" key={action.id}><h4>{action.label}</h4><p>{action.condition}</p><pre>{action.intent_json}</pre><code>SHA-256: {action.intent_hash}</code>{action.release && <p>Queue record: <code>{action.release.id}</code> · source v{action.release.revision}</p>}</div>)}<p>Queue records prove that the contract released a registered job. They do not prove an external purchase, payment or delivery.</p></details><div className="pgc-publish">
              <div className="pgc-archive-heading"><h3>A permanent audit copy</h3><a href="https://docs.ar.io/sdks/turbo-sdk" target="_blank" rel="noreferrer">AR.IO · Turbo SDK <ArrowUpRight size={13} /></a></div>
              <p>Keep the GenLayer decision, its evidence and job records together. Turbo SDK uploads the package to Arweave; an AR.IO gateway gives you a shareable address.</p>
              <p className="pgc-archive-detail">GenLayer is read again before publication. The uploaded file is then retrieved and its bytes and SHA-256 checked against your package.</p>
              {!publication && <Button variant="outline" className="pgc-button" disabled={busy || unresolvedTransaction || !currentReview || archiveUnknown} onClick={() => run(prepareArchive)}>{archiveDraft ? "Refresh package and price" : "Prepare archive and check price"}</Button>}
              {archiveDraft && !publication && <div className="pgc-archive-quote"><strong>{formatUnits(BigInt(archiveDraft.quotedWinc), 12)} Turbo credits · estimated upload</strong><p>{archiveDraft.bytes.toLocaleString("en-US")} bytes of audit data. The estimate includes space for the signature and metadata. The exact cost is checked again before upload.</p><p>Uses existing Turbo credits for the wallet signing this archive. No automatic top-up. <a href="https://console.ar.io" target="_blank" rel="noreferrer">Manage credits in AR.IO Console <ArrowUpRight size={13} /></a></p><small>Your wallet signs a connection message and the audit data. These signatures do not send a GenLayer transaction.</small><details><summary>Review the exact package before publishing</summary><code>SHA-256: {archiveDraft.sha256}</code><pre>{archiveDraft.text}</pre></details></div>}
              <label className="pgc-consent"><Checkbox checked={consent} onCheckedChange={value => setConsent(value === true)} disabled={busy || !!publication || !archiveDraft} /><span>I approve this public, permanent upload using the quoted Turbo credits.</span></label>
              <Button className="pgc-button" disabled={busy || unresolvedTransaction || !consent || !currentReview || !!publication || archiveUnknown || !archiveDraft} onClick={() => run(publishAudit)}>{publication ? <Check size={17} /> : publishing ? <LoaderCircle className="pgc-spin" size={17} /> : <Upload size={17} />}{publication ? publication.retrieval === "VERIFIED" ? "Archive verified" : publication.uploadStatus === "SUBMITTED" ? "Check upload status below" : "Upload accepted" : publishing ? "Signing and publishing" : "Sign and publish permanent copy"}</Button>
              {archiveError && <p className="pgc-error" role="alert">{archiveError}</p>}
              {archiveUnknown && !publishing && <div className="pgc-archive-uncertain" role="status"><strong>An earlier upload has no confirmed result.</strong><p>This device remembers the attempt to prevent an accidental duplicate. If you saved its publication record, keep that record and its archive URL. Another upload is not needed to inspect your GenLayer case.</p><details><summary>Allow a new upload after checking the earlier attempt</summary><p>Only use this if you have checked the earlier upload. A new attempt may create another public copy.</p><Button variant="outline" className="pgc-button" disabled={busy} onClick={() => { try { clearArchive(localStorage, address, record.id, record.revision); } catch { /* optional */ } setArchiveUnknown(false); setPublication(null); setArchiveDraft(null); setConsent(false); setArchiveError(""); }}>I checked the earlier attempt; reset upload</Button></details></div>}

              {publication && <div className="pgc-publication">
                <strong>{publication.retrieval === "VERIFIED" ? "File retrieved; content verified" : publication.retrieval === "MISMATCH" ? "File content does not match" : publication.uploadStatus === "SUBMITTED" ? "Upload reply unavailable; check this record" : "Upload accepted; retrieval not yet verified"}</strong>
                <p>{publication.retrieval === "VERIFIED" ? "The file retrieved through the AR.IO gateway matches the size and SHA-256 of the uploaded package." : publication.retrieval === "MISMATCH" ? "The retrieved bytes differ from your package. This copy has not passed verification." : "The file may take time to become available. Check retrieval again without uploading another copy."}</p>
                <div className="pgc-inline"><a href={publication.url} target="_blank" rel="noreferrer">Open archived file <ArrowUpRight size={16} /></a><Button variant="outline" className="pgc-button" disabled={busy} onClick={() => run(checkArchive)}><RotateCcw size={15} />Check retrieval again</Button></div>
                <details><summary>Record ID and verification details</summary><span>Record ID</span><code>{publication.recordId}</code><span>Package SHA-256</span><code>{publication.sha256}</code><p>This check confirms that the same file is retrievable now. Settlement on Arweave is not verified by this check.</p></details>
                <Button variant="outline" onClick={() => downloadFile(`${publication.caseId}-publication.json`, JSON.stringify(publication, null, 2))}>Download publication record</Button>
                {(publication.uploadStatus === "ACCEPTED" || publication.retrieval === "VERIFIED") && <p className="pgc-archive-credit">Powered by AR.IO · Turbo upload and gateway access. Decisions come from GenLayer.</p>}
              </div>}
            </div></div></section>}
          <div className="pgc-footer-actions"><Button variant="ghost" disabled={busy || unresolvedTransaction} onClick={startCase}>Create another case</Button><Button variant="ghost" disabled={busy} onClick={() => run(async () => { await navigator.clipboard.writeText(address); setNotice("Contract address copied."); })}><Copy size={14} />{compact(address)}</Button><a href={CHANGE_EXPLORER} target="_blank" rel="noreferrer">Explorer <ArrowUpRight size={14} /></a></div>
        </>}
        <footer className="pgc-footer"><span>ProofGuard Change</span><span>Decision: GenLayer · Enforcement: registered job queue</span></footer>
      </main>
    </div>
  </div>;
}

function EvidenceText({ text, translation }: { text: string; translation?: string }) {
  return <><blockquote className="pgc-quote">{translation || text}</blockquote>{translation && <details className="pgc-original"><summary>Original on-chain evidence · Turkish</summary><blockquote className="pgc-quote" lang="tr">{text}</blockquote><small>The English text is an explanation. Verification uses the original bytes.</small></details>}</>;
}
