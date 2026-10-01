"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Hydrate URL and device-local recovery pointers after SSR; never render a cached decision as network authority. */

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronRight, Copy, Download, FileCheck2, FileText, Fingerprint, GitBranch, Layers3, LoaderCircle, LockKeyhole, Plus, RefreshCw, ShieldCheck, Trash2, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NetworkActivity } from "./change-network-activity";
import { NetworkArchive } from "./change-network-archive";
import { useDepthSurface } from "./use-depth-surface";
import walkthrough from "@/config/change-network-walkthrough.json";
import { currentWallet, observeWallet, disconnectWallet } from "@/genlayer/wallet-connection";
import { walletErrorMessage } from "@/genlayer/wallet-network.mjs";
import { PUBLIC_APP_URL } from "@/config/public-site";
import { reusableNetworkSetup } from "@/genlayer/change-network-reuse.mjs";
import { addNetworkToWallet, connectNetworkWallet, deployNetwork, downloadFile, networkAudit, NETWORK_CHAIN, NETWORK_SOURCE, readSourceBundle, resumeNetworkTransaction, validAddress, verifyNetworkContract, writeNetwork, type JobInput, type NetworkJob, type NetworkProgress, type NetworkWorkflow, type SourceBundle } from "@/genlayer/change-network-client";
import { readNetworkPending, rememberNetworkPending, readNetworkArchive, rememberNetworkArchive, clearNetworkArchive } from "@/genlayer/change-network-session.mjs";
import { ArchiveRejected, prepareAuditArchive, uploadAuditSnapshot, verifyArchiveRetrieval, type ArchiveDraft, type ArchivePublication } from "@/genlayer/change-publication";
import { readableNetworkAudit } from "@/genlayer/change-network-report.mjs";

type Scenario = keyof typeof walkthrough;
type Tab = "impact" | "build" | "audit";
const short = (s: string) => s.length > 22 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s;
const stepLabels = ["Original permits", "Source corrected", "Selective review", "Protected outputs"];
const stageCopy = ["Three jobs have permission to use the original source.", "One revision fences every unused permit. Each job waits for a fresh review.", "Each job is judged against its own condition. Only supported jobs can receive a new permit.", "Eligible jobs produce downloadable artifacts. The held job produces nothing."];
const liveStages = ["Connect", "Shared evidence", "Protected jobs", "Review & execute"];
const liveTitles = ["Start with your workspace.", "Give your agents a source.", "Define what each job needs.", "Review. Authorize. Execute."];
const liveDescriptions = ["Open an existing record with its contract and Source ID, or connect your wallet to create a new workspace.", "Publish original evidence, or inspect and maintain an existing source. Continue only when the source has been read from finalized state.", "Register the exact tool, target, parameters and condition for each protected job. Every workflow has an owner and executor.", "Read each decision, authorize supported jobs and generate their outputs. Progress follows finalized contract records."];
function jobInput(id = "job-1"): JobInput {
  return { id, label: "", condition: "", tool: "prepare_purchase_order", target: "", payload: { unit_price: 0, currency: "EUR", quantity: 1, shipping: "standard" } };
}
function tone(job: NetworkJob) { return job.execution ? "done" : job.gate === "MATERIAL_CHANGE" ? "blocked" : job.gate === "INSUFFICIENT_EVIDENCE" ? "uncertain" : job.gate === "READY" ? "ready" : "waiting"; }
function status(job: NetworkJob) { return job.execution ? "Output created" : job.gate === "MATERIAL_CHANGE" ? "Blocked" : job.gate === "INSUFFICIENT_EVIDENCE" ? "Evidence needed" : job.gate === "READY" ? job.active_permit ? "Permitted" : "Can proceed" : "Awaiting review"; }
function Marked({ text, quote, kind }: { text: string; quote?: string; kind: string }) {
  if (!quote || !text.includes(quote)) return <>{text}</>;
  const i = text.indexOf(quote);
  return <>{text.slice(0, i)}<mark className={kind}>{quote}</mark>{text.slice(i + quote.length)}</>;
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) { return <label className="nw-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }

export function ChangeNetworkWorkspace({ embedded = false, demoStage, initialTab = "build", demoScenario = "material" }: { embedded?: boolean; demoStage?: number; initialTab?: Tab; demoScenario?: Scenario }) {
  const depthSurface = useDepthSurface();
  const [live, setLive] = useState(false);
  const [modeReady, setModeReady] = useState(false);
  const [scenario, setScenario] = useState<Scenario>(demoScenario);
  const [localStep, setStep] = useState(0);
  const step = demoStage ?? localStep;
  const [tab, setTab] = useState<Tab>(initialTab);
  const [liveStep, setLiveStep] = useState(0);
  const [selected, setSelected] = useState("WF-1/urgent");
  const [contract, setContract] = useState("");
  const [contractInput, setContractInput] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [sourceInput, setSourceInput] = useState("");
  const [record, setRecord] = useState<SourceBundle | null>(null);
  const [observed, setObserved] = useState("");
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [rawError, setError] = useState("");
  const error = walletErrorMessage(rawError);
  const [errorDetails, setErrorDetails] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState<NetworkProgress | null>(null);
  const [pending, setPending] = useState<NetworkProgress | null>(null);
  const [activityDismissed, setActivityDismissed] = useState(false);
  const [operation, setOperation] = useState("Updating workspace…");
  const [activeJob, setActiveJob] = useState("");
  const [share, setShare] = useState("");
  const [publication, setPublication] = useState<ArchivePublication | null>(null);
  const [draft, setDraft] = useState<ArchiveDraft | null>(null);
  const [archiveConsent, setArchiveConsent] = useState(false);
  const [archiveActivity, setArchiveActivity] = useState("");
  const [setupDraftReady, setSetupDraftReady] = useState(false);
  const [setupSourceId, setSetupSourceId] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [correction, setCorrection] = useState("");
  const [approvedOwner, setApprovedOwner] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [workflowTitle, setWorkflowTitle] = useState("");
  const [executor, setExecutor] = useState("");
  const [jobs, setJobs] = useState<JobInput[]>([jobInput()]);
  const [advancedJson, setAdvancedJson] = useState("");

  const bundle = live ? record : walkthrough[scenario].stages[step] as unknown as SourceBundle;
  const items = bundle?.workflows.flatMap(w => w.actions.map(a => ({ w, a, key: `${w.id}/${a.id}` }))) || [];
  const focused = items.find(x => x.key === selected) || items[0];
  const review = focused?.w.reviews.find(r => r.revision === bundle?.source.revision)?.actions.find(a => a.id === focused.a.id);
  const blocked = items.filter(x => x.a.gate === "MATERIAL_CHANGE").length;
  const uncertain = items.filter(x => x.a.gate === "INSUFFICIENT_EVIDENCE").length;
  const ready = items.filter(x => !x.a.execution && x.a.gate === "READY").length;
  const completed = items.filter(x => x.a.execution).length;
  const waiting = items.length - blocked - uncertain - ready - completed;
  const disabled = busy || !!pending;
  const reusableSetup = record ? reusableNetworkSetup(record, account) : null;
  const isPublisher = !!account && account === bundle?.source.publisher;
  const canAdvance = liveStep === 0 ? !!contract && (!!account || !!record) && contract === contractInput && (!sourceInput || sourceInput === sourceId) : liveStep === 1 ? !!record : items.length > 0;
  const runComplete = live && liveStep === 3 && !!record && items.length > 0 && !busy && !pending && record.workflows.every(w => w.reviewed_revision === record.source.revision) && items.every(({ a }) => !!a.execution || ["MATERIAL_CHANGE", "INSUFFICIENT_EVIDENCE"].includes(a.gate));

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (embedded) { setModeReady(true); return; }
    const chosen = params.get("scenario");
    if (chosen && Object.hasOwn(walkthrough, chosen)) setScenario(chosen as Scenario);
    const c = params.get("contract") || "", s = params.get("source") || "";
    if (params.get("mode") === "live" || (params.get("mode") !== "demo" && validAddress(c) && s)) {
      setLive(true); setContractInput(c); setSourceInput(s);
      setTab("build");
    }
    const p = readNetworkPending(localStorage); if (p) { setPending(p); setProgress(p); }
    setModeReady(true);
    // Initialize mode before showing data, so a Live URL never flashes Demo records.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!live) return;
    return observeWallet(({ event, value }) => {
      if (event === "chainChanged" && Number(value) === NETWORK_CHAIN.id) return;
      if (event === "accountsChanged" && Array.isArray(value) && value[0]?.toLowerCase() === account) return;
      setAccount("");
      if (account) setNotice(event === "disconnect" ? "Wallet disconnected. Reconnect before sending another transaction." : "Wallet changed. Connect again to confirm the current account and network.");
    });
  }, [live, account]);
  useEffect(() => {
    if (!busy) return;
    const preventExit = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventExit);
    return () => window.removeEventListener("beforeunload", preventExit);
  }, [busy]);
  useEffect(() => {
    setDraft(null); setArchiveConsent(false); setPublication(null);
    if (live && contract && record) {
      const p = readNetworkArchive(localStorage, contract, record.source.id, record.source.revision);
      if (p) { setPublication(p); }
    }
  }, [live, contract, record]);

  async function run(action: () => Promise<void>, label = "Updating workspace…") {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setErrorDetails(""); setNotice("");
    setProgress(pending); setActivityDismissed(false); setOperation(label); setActiveJob("");
    try { await action(); } catch (e) {
      setError(e instanceof Error ? e.message : "The operation could not be completed.");
      if (e instanceof Error && e.cause) setErrorDetails(e.cause instanceof Error ? e.cause.message : String(e.cause));
      // Preserve submitted transactions for recovery, but stop a failed preflight.
      setProgress(previous => previous?.hash ? previous : null);
    }
    finally { lock.current = false; setBusy(false); }
  }
  function onProgress(p: NetworkProgress) {
    setProgress(p); setActivityDismissed(false); rememberNetworkPending(localStorage, p);
    if (p.hash) setPending(p.finalized || p.failed ? null : p);
  }
  async function loadSource(c = contract, s = sourceId) {
    // Keep the current snapshot visible during a refresh; busy disables writes.
    // A failed read clears it so stale records cannot authorize another action.
    setObserved("");
    try {
      const next = await readSourceBundle(c, s);
      setRecord(next); setContract(c); setContractInput(c); setSourceId(s); setSourceInput(s); setObserved(new Date().toISOString());
      setSelected(previous => next.workflows.some(w => w.actions.some(a => `${w.id}/${a.id}` === previous)) ? previous : `${next.workflows[0]?.id}/${next.workflows[0]?.actions[0]?.id}`);
    } catch (e) { setRecord(null); setError(e instanceof Error ? e.message : "Could not read the source."); throw e; }
  }
  async function write(method: string, args: (string | bigint)[], refreshId = sourceId) {
    if (!live) throw new Error("Switch to Live before sending a blockchain transaction.");
    if (pending) throw new Error("Recover the submitted transaction before starting another write.");
    setActiveJob(["authorize_action", "execute_action"].includes(method) ? `${args[0]}/${args[1]}` : "");
    await writeNetwork(contract, method, args, onProgress);
    if (refreshId) await loadSource(contract, refreshId);
    setNotice("Transaction finalized. The source and all dependent workflows have been read again.");
  }
  function form(action: () => Promise<void>) { return (e: FormEvent) => { e.preventDefault(); void run(action); }; }
  async function connect() {
    if (!live) throw new Error("Wallet connections are available in Live mode only.");
    setOperation("Connect in your browser wallet, or scan the MetaMask QR code with your phone.");
    const value = await connectNetworkWallet(); setAccount(value.account); if (!executor) setExecutor(value.account);
    setNotice("Wallet connected to GenLayer Studionet.");
  }
  function switchMode(nextLive: boolean) {
    if (lock.current || pending || nextLive === live) return;
    window.location.assign(`./?mode=${nextLive ? "live" : "demo"}`);
  }
  function goToStage(next: number) {
    if (disabled) return;
    if (next === 1 && setupDraftReady && !record) setSourceInput(setupSourceId);
    setLiveStep(next); setTab(next === 3 ? "impact" : "build"); setShare(""); setNotice(""); setError("");
    document.getElementById("network-main")?.scrollIntoView({ block: "start", behavior: "auto" });
  }
  function reuseSetup() {
    if (disabled || !reusableSetup) return;
    const setup = reusableSetup;
    setSourceInput(""); setSourceId(""); setSetupSourceId(setup.sourceId); setSourceTitle(setup.sourceTitle); setSourceText(setup.sourceText);
    setWorkflowId(setup.workflowId); setWorkflowTitle(setup.workflowTitle); setExecutor(setup.executor); setJobs(setup.jobs as JobInput[]);
    setAdvancedJson(""); setContract(""); setContractInput(""); setRecord(null); setObserved("");
    setCorrection(""); setApprovedOwner(""); setProgress(null); setSetupDraftReady(true);
    window.history.replaceState(null, "", "./?mode=live");
    goToStage(0);
    setNotice("Your source and job definitions are ready in the forms. Deploy the updated contract, then publish the source and register the workflow. Each transaction needs your wallet approval. Keep this page open until the setup is registered.");
  }
  function startLive() { switchMode(true); }
  function openAudit() {
    setTab("audit");
    document.getElementById("network-main")?.scrollIntoView({ block: "start", behavior: "auto" });
  }
  async function recoverTransaction() {
    if (!pending?.hash) return;
    const receipt = await resumeNetworkTransaction(pending.hash, p => onProgress({ ...p, contract: pending.contract, method: pending.method, caseId: pending.caseId }));
    if (pending.method === "deploy") {
      const decoded = receipt.txDataDecoded;
      const c = String((decoded && "contractAddress" in decoded ? decoded.contractAddress : undefined) || receipt.recipient || receipt.to_address || "");
      await verifyNetworkContract(c); setContract(c); setContractInput(c);
    } else if (contract && sourceId) await loadSource();
    setNotice("The original transaction was checked. No duplicate was submitted.");
  }
  function updateJob(index: number, change: Partial<JobInput>) { setJobs(old => old.map((j, i) => i === index ? { ...j, ...change } : j)); }
  async function copyLink() {
    const u = new URL(PUBLIC_APP_URL);
    u.searchParams.set("mode", live ? "live" : "demo");
    if (live) {
      if (contract) u.searchParams.set("contract", contract);
      if (sourceId) u.searchParams.set("source", sourceId);
    } else u.searchParams.set("scenario", scenario);
    setShare(u.toString());
    try { await navigator.clipboard.writeText(u.toString()); setNotice("Link copied."); } catch { setNotice("Copy the link shown below."); }
  }
  async function audit() {
    if (!live || !record) return { schema: "proofguard-simulated-walkthrough/2.0", network: "LOCAL SIMULATION", readState: "SIMULATED", observedAt: new Date().toISOString(), contract: "No deployed contract", contractSourceSha256: "Not a network proof", bundle, executionScope: "Illustrative execution of the contract state machine with mocked review responses. No network transactions, orders or payments were submitted.", verification: ["This is sample data, not a live GenLayer result.", "Use the live workspace with a deployed v2 contract for an independently verifiable record."] };
    return networkAudit(contract, sourceId);
  }
  async function exportAudit(html = false) { const value = await audit(); downloadFile(`${live ? "ProofGuard" : "SIMULATED-ProofGuard"}-${value.bundle?.source.id || "source"}-v${value.bundle?.source.revision}.${html ? "html" : "json"}`, html ? readableNetworkAudit(value) : JSON.stringify(value, null, 2), html ? "text/html" : "application/json"); }
  function archiveProgress(label: string) { setArchiveActivity(label); setOperation(label); }
  function storePublication(p: ArchivePublication) { setPublication(p); rememberNetworkArchive(localStorage, p); }
  async function prepareArchive() {
    if (!live || !record) return;
    archiveProgress("Reading the finalized record and checking the Turbo upload price…");
    const value = await networkAudit(contract, sourceId);
    const next = await prepareAuditArchive(JSON.stringify(value, null, 2), { contract, caseId: sourceId, revision: value.bundle.source.revision });
    setDraft(next); setArchiveConsent(false);
  }
  async function publishArchive() {
    if (!live || !draft || !archiveConsent || !currentWallet() || publication) throw new Error("Prepare and approve a fresh archive first.");
    try {
      archiveProgress("Confirm the signing requests in your wallet…");
      const p = await uploadAuditSnapshot(draft, currentWallet()!, submitted => { storePublication(submitted); archiveProgress("Uploading the signed snapshot through Turbo…"); });
      storePublication(p); archiveProgress("Checking the gateway response against the signed snapshot…");
      storePublication(await verifyArchiveRetrieval(p)); setDraft(null);
    } catch (e) {
      // An explicit upload rejection is retryable. An unknown POST result keeps
      // its signed record ID and permits only GET recovery, avoiding duplicates.
      if (e instanceof ArchiveRejected) { clearNetworkArchive(localStorage, draft.contract, draft.caseId, draft.revision); setPublication(null); setDraft(null); setArchiveConsent(false); }
      throw e;
    }
  }

  if (!modeReady) return <div className="nw-app" ref={depthSurface}><main className="nw-main" aria-busy="true"><p role="status">Opening workspace…</p></main></div>;

  return <div className={`nw-app ${embedded ? "nw-embedded" : "nw-live-journey"} ${live && liveStep === 3 ? "nw-review-workspace" : ""} ${live && !activityDismissed && (busy || progress || error) ? "nw-has-activity" : ""}`} data-setup-step={liveStep} ref={depthSurface}>
    <a href="#network-main" className="nw-skip">Skip to workspace</a>
    <header className="nw-header">
      <a href="./" className="nw-brand" aria-label="ProofGuard Change home"><span className="nw-logo"><ShieldCheck size={22} /></span><strong>ProofGuard<span> / Change</span></strong></a>
      <div className="nw-header-right">
        {live && <Button className="nw-button nw-wallet" variant="outline" disabled={busy} onClick={() => void run(connect)}><Wallet size={16} /><span>{account ? short(account) : "Connect wallet"}</span></Button>}
        <div className="nw-mode-control">
          <div className="nw-mode-switch" role="group" aria-label="Workspace mode">
            <Button type="button" variant="outline" className={`nw-button nw-mode-option live ${live ? "selected" : ""}`} aria-pressed={live} aria-describedby="workspace-mode-description" disabled={disabled} onClick={() => switchMode(true)}>Live</Button>
            <Button type="button" variant="outline" className={`nw-button nw-mode-option demo ${!live ? "selected" : ""}`} aria-pressed={!live} aria-describedby="workspace-mode-description" disabled={disabled} onClick={() => switchMode(false)}>Demo</Button>
          </div>
          <span id="workspace-mode-description" className="nw-mode-caption" aria-live="polite">{live ? "GenLayer test network" : "Sample data · no transactions"}</span>
        </div>
      </div>
    </header>
    <main id="network-main" className="nw-main">
      <section className="nw-hero">
        <div><div className="nw-eyebrow">{live ? `LIVE / STEP ${liveStep + 1} OF 4` : "DEMO / COMPLETE RECORD"}</div><h1>{live ? liveTitles[liveStep] : "The complete decision record."}</h1><p>{live ? liveDescriptions[liveStep] : "Inspect the evidence, permissions and protected outputs."}</p></div>
      </section>
      {live && <nav className="nw-live-steps" aria-label="Live workflow stages">{liveStages.map((label, i) => <button key={label} disabled={disabled || i > liveStep} aria-current={i === liveStep ? "step" : undefined} onClick={() => goToStage(i)}><span>{i < liveStep ? <Check size={17} /> : `0${i + 1}`}</span>{label}</button>)}</nav>}
      {(embedded || liveStep === 3) && <div className="nw-toolbar"><nav aria-label="Workspace sections">{([['impact','Impact map',GitBranch],['audit','Audit trail',Fingerprint]] as const).map(([id,label,Icon]) => <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}><Icon size={16} />{label}</button>)}</nav><button className="nw-text-button" onClick={() => void run(copyLink)}><Copy size={14} />Share workspace</button></div>}
      {!live && <section className="nw-walkthrough" aria-label="Simulated walkthrough controls"><div className="nw-demo-label"><span>DEMO SCENARIO</span><strong>Simulated · no transactions sent</strong></div><label className="nw-scenario"><span className="nw-sr">Choose scenario</span><select value={scenario} onChange={e => { setScenario(e.target.value as Scenario); setStep(2); }}>{Object.entries(walkthrough).map(([id,s]) => <option key={id} value={id}>{s.title}</option>)}</select></label><div className="nw-steps">{stepLabels.map((label,i) => <button key={label} onClick={() => { setStep(i); setTab("impact"); }} aria-current={step === i ? "step" : undefined}><span>{i + 1}</span>{label}</button>)}</div></section>}
      {share && <div className="nw-notice"><span>Workspace link</span><input aria-label="Shareable workspace link" readOnly value={share} onFocus={e => e.target.select()} /><button onClick={() => setShare("")} aria-label="Dismiss share link"><X size={16} /></button></div>}
      {error && <div className="nw-message error" role="alert"><strong>Could not complete this step.</strong><p>{error}</p>{(errorDetails || rawError !== error) && <details className="nw-details"><summary>Technical details</summary><p>{errorDetails || rawError}</p></details>}</div>}
      {notice && !(live && progress?.finalized && !activityDismissed) && <div className="nw-message" role="status">{notice}</div>}
      {live && record?.reviewEngine === "legacy-quotes" && <div className="nw-message" role="status"><strong>An updated review engine is available.</strong><p>This contract uses the earlier quotation format. Existing records remain readable. Create a new contract to use reviews that select exact source excerpts.</p><div className="nw-actions">{reusableSetup ? <Button className="nw-button primary" disabled={disabled} onClick={reuseSetup}>Reuse source and job definitions <ArrowRight size={15} /></Button> : !account ? <Button className="nw-button primary" disabled={disabled} onClick={() => void run(connect)}>Connect wallet to reuse setup</Button> : <span>Automatic reuse is available for a single, unreviewed workflow at source v1 owned by your wallet. Preserve the audit before preparing a new workspace.</span>}<Button className="nw-button" variant="outline" disabled={disabled} onClick={() => void run(() => exportAudit())}>Download existing record <Download size={14} /></Button></div></div>}


      {tab === "impact" && <>
        {!bundle ? <section className="nw-empty"><Layers3 size={36} /><h2>Bring your first source into view.</h2><p>Open a deployed Change Network contract or create one. Register a source and the jobs that depend on it.</p><Button className="nw-button primary" onClick={() => setTab("build")}>Set up workspace <ArrowRight size={16} /></Button></section> : <>
          <div className="nw-section-heading"><div><div className="nw-eyebrow">{live ? "FINALIZED SOURCE SNAPSHOT" : `WALKTHROUGH / ${String(step + 1).padStart(2,"0")}`}</div><h2>{bundle.source.title}</h2><p>{live ? `Read ${observed ? new Date(observed).toLocaleTimeString("en-GB") : "from GenLayer"}. Refresh to check for newer revisions.` : stageCopy[step]}</p></div><div className="nw-actions">{live ? <><Button variant="outline" className="nw-button" disabled={busy} onClick={() => void run(() => loadSource())}><RefreshCw size={15} />Refresh</Button>{record?.reviewEngine !== "legacy-quotes" && bundle.workflows.some(w => w.reviewed_revision !== bundle.source.revision) && <Button className="nw-button primary" disabled={disabled} onClick={() => void run(() => write("review_source", [sourceId, BigInt(bundle.source.revision)]))}>Review all dependent jobs <ArrowRight size={15} /></Button>}</> : <Button className="nw-button primary" onClick={() => setStep(step === 3 ? 0 : step + 1)}>{step === 2 ? "Generate eligible outputs" : step === 3 ? "Replay scenario" : step === 1 ? "Review the impact" : "Apply source correction"}<ArrowRight size={16} /></Button>}</div></div>
          <div className="nw-metrics"><div><span>Shared source</span><strong>01<small>v{bundle.source.revision}</small></strong></div><div><span>Dependent workflows</span><strong>{String(bundle.workflows.length).padStart(2,"0")}<small>{items.length} jobs</small></strong></div><div className={blocked || uncertain ? "negative" : ""}><span>Jobs held</span><strong>{String(blocked + uncertain + waiting).padStart(2,"0")}<small>{uncertain ? "evidence needed" : waiting ? "review needed" : "material change"}</small></strong></div><div className="positive"><span>{completed ? "Outputs created" : "Can proceed"}</span><strong>{String(completed || ready).padStart(2,"0")}<small>{completed ? "downloadable" : "individually checked"}</small></strong></div></div>
          <div className="nw-impact-grid">
            <section className="nw-map" aria-label="Source dependency map"><div className="nw-panel-label"><GitBranch size={15} />DEPENDENCY MAP<span>{live ? "Contract state" : "Sample state"}</span></div><div className="nw-source-node"><div><span className="nw-node-icon"><FileText size={20} /></span><div><small>SHARED SOURCE · v{bundle.source.revision}</small><strong>{bundle.source.title}</strong><span>{bundle.source.id} · publisher {short(bundle.source.publisher)}</span></div></div><div className="nw-source-foot"><Fingerprint size={13} />{short(bundle.source.versions.at(-1)!.sha256)}<span>One revision, {bundle.workflows.length} workflows</span></div></div><div className="nw-map-trunk"><ArrowDown size={17} /><span>Registered dependencies</span></div><div className="nw-workflows">{bundle.workflows.map((w,index) => <div className="nw-workflow" key={w.id}><div className="nw-workflow-title"><span>0{index + 1}</span><div><strong>{w.title}</strong><small>Owner {short(w.owner)} · baseline v{w.baseline_revision}</small></div></div><div className="nw-job-list">{w.actions.map(a => <button key={a.id} className={`nw-job ${tone(a)} ${busy && activeJob === `${w.id}/${a.id}` ? "nw-job-processing" : ""} ${focused?.key === `${w.id}/${a.id}` ? "selected" : ""}`} aria-pressed={focused?.key === `${w.id}/${a.id}`} onClick={() => setSelected(`${w.id}/${a.id}`)}><div><span className="nw-job-symbol">{a.execution ? <FileCheck2 size={18} /> : a.gate === "READY" ? <Check size={18} /> : <LockKeyhole size={17} />}</span><strong>{a.label}</strong><ChevronRight size={15} /></div><span className={`nw-status ${tone(a)}`}>{status(a)}</span><small>{a.execution ? "Protected artifact is available" : a.gate === "READY" ? "The condition is still supported" : a.gate === "MATERIAL_CHANGE" ? "The condition is no longer supported" : a.gate === "INSUFFICIENT_EVIDENCE" ? "The source cannot establish the condition" : "Previous permits cannot be used"}</small></button>)}</div></div>)}</div>{!bundle.workflows.length && <p className="nw-muted">Register a workflow to connect its protected jobs to this source.</p>}<p className="nw-map-caption"><ShieldCheck size={14} />Each job is bound to its tool, target, parameters and source revision.</p></section>
            <section className={`nw-evidence ${busy && activeJob === focused?.key ? "nw-job-processing" : ""}`} aria-label="Selected job evidence" aria-busy={busy && activeJob === focused?.key}>{focused ? <>
              <div className="nw-panel-label"><Layers3 size={15} />WHY THIS JOB?<span>v{focused.w.baseline_revision} → v{bundle.source.revision}</span></div>
              <div className="nw-evidence-title"><h3>{focused.a.label}</h3><span className={`nw-status ${tone(focused.a)}`}>{status(focused.a)}</span></div>
              <p className="nw-condition"><small>REQUIRED CONDITION</small>{focused.a.condition}</p>
              <div className={`nw-reason ${tone(focused.a)}`}><strong>{review ? live ? "GenLayer review" : "Illustrative review" : "Fresh review required"}</strong><p>{review?.reason || "This source revision has not been reviewed for this workflow. Earlier permits cannot authorize a new output."}</p></div>
              <JobDetails live={live} workflow={focused.w} job={focused.a} account={account} disabled={disabled} processing={busy && activeJob === focused.key} operation={progress?.method} onAuthorize={() => void run(() => write("authorize_action", [focused.w.id, focused.a.id, BigInt(bundle.source.revision), focused.a.intent_hash]))} onExecute={() => void run(() => write("execute_action", [focused.w.id, focused.a.id, BigInt(bundle.source.revision), focused.a.intent_hash]))} />
              <EvidenceSources key={`${focused.key}/${bundle.source.revision}`} original={bundle.source.versions[focused.w.baseline_revision - 1]} current={bundle.source.versions.at(-1)!} review={review} kind={tone(focused.a)} />
            </> : <div className="nw-empty small"><FileText size={25} /><p>Choose a registered job to inspect its evidence.</p></div>}</section>
          </div>
          {!runComplete && <div className="nw-bottom-note"><span><LockKeyhole size={17} /><strong>A permission is not an output.</strong> Execution checks the current source again.</span><button className="nw-text-button" onClick={openAudit}>Inspect complete record <ArrowRight size={15} /></button></div>}
        </>}
      </>}

      {tab === "build" && <section className="nw-builder"><div className="nw-section-heading"><div><div className="nw-eyebrow">{live ? "LIVE WORKSPACE" : "LIVE WORKSPACE SETUP"}</div><h2>Make the dependency explicit.</h2><p>Publish evidence, register a workflow, then let each job earn its permission.</p></div>{!live && <Button className="nw-button primary" onClick={startLive}>Switch to live workspace <ArrowRight size={16} /></Button>}</div>{!live ? <div className="nw-empty"><GitBranch size={30} /><h3>Your wallet owns your workflow.</h3><p>The walkthrough uses sample records. Switch to the live workspace to open a v2 contract or deploy one with your wallet.</p></div> : <div className="nw-builder-grid"><div>
          <section className="nw-form-card nw-connect-card"><p className="nw-read-only-entry">Just looking? <a href="./?mode=inspect">Open Evidence Desk without a wallet <ArrowUpRight size={13} /></a></p><div className="nw-form-title"><span>01</span><div><h3>Connect the workspace</h3><p>GenLayer Studionet · chain {NETWORK_CHAIN.id}</p></div></div><div className="nw-live-wallet"><span>{account ? "Wallet connected. Verify the contract below." : "Connect a browser wallet or MetaMask mobile to create or authorize work. Reading an existing record needs no wallet."}</span><Button className="nw-button primary" disabled={disabled} onClick={() => void run(connect)}><Wallet size={16} />{account ? short(account) : "Connect wallet"}</Button></div>{account && <button className="nw-text-button" disabled={disabled} onClick={() => void run(async () => { await disconnectWallet(); setAccount(""); setNotice("Wallet disconnected from this workspace."); })}>Disconnect wallet</button>}<button className="nw-text-button" disabled={disabled} onClick={() => void run(async () => { setOperation("Approve adding GenLayer Studionet in MetaMask."); const value = await addNetworkToWallet(); setAccount(value.account); if (!executor) setExecutor(value.account); setNotice("GenLayer Studionet was added to your wallet. You can continue."); })}>Add GenLayer network</button><form onSubmit={form(async () => { await verifyNetworkContract(contractInput); setContract(contractInput); setRecord(null); setSourceId(""); if (sourceInput) { await loadSource(contractInput,sourceInput); setLiveStep(3); setTab("impact"); setNotice("Existing record opened. Connect a wallet only when you want to submit a transaction."); } else setNotice("Contract code verified. You can publish a new source."); })}><Field label="Change Network v2 contract"><input required placeholder="0x…" value={contractInput} onChange={e => { setContractInput(e.target.value); setContract(""); setRecord(null); setSourceId(""); }} pattern="0x[a-fA-F0-9]{40}" /></Field><Field label="Source ID" hint="Leave empty when opening a contract to publish a new source."><input placeholder="e.g. SUPPLIER-TERMS-01" value={sourceInput} onChange={e => { setSourceInput(e.target.value); setContract(""); setRecord(null); setSourceId(""); }} maxLength={80} /></Field><Button className="nw-button primary" disabled={disabled}>Open workspace <ArrowRight size={15} /></Button></form><details className="nw-details" open={setupDraftReady || undefined}><summary>Need a new contract?</summary><p>Deploy this version from your wallet. The contract code will become public on GenLayer. Test tokens are required.</p><div className="nw-actions"><Button className="nw-button" variant="outline" disabled={disabled} onClick={() => void run(async () => { const d = await deployNetwork(onProgress); setContract(d.address); setContractInput(d.address); setRecord(null); if (!setupDraftReady) setSourceId(""); setNotice("Contract deployed and code verified. Continue to shared evidence."); })}>Deploy v2 contract</Button><button className="nw-text-button" onClick={() => downloadFile("change_network.py",NETWORK_SOURCE,"text/plain")}>Review contract code <Download size={14} /></button></div><a href="https://docs.genlayer.com/developers/networks" target="_blank" rel="noreferrer">Network and test-token information <ArrowUpRight size={13} /></a></details>{contract && <p className="nw-verified"><ShieldCheck size={14} />Verified contract: {short(contract)}</p>}</section>
          <section className="nw-form-card nw-source-card"><div className="nw-form-title"><span>02</span><div><h3>{record ? "Maintain the shared source" : "Publish the shared source"}</h3><p>{record ? `Publisher: ${short(record.source.publisher)}` : "Your connected wallet becomes the source publisher."}</p></div></div>{!record ? <form onSubmit={form(async () => { await write("publish_source",[sourceInput,sourceTitle,sourceText],sourceInput); })}><Field label="New source ID"><input required minLength={2} maxLength={80} pattern="[A-Za-z0-9_.-]+" placeholder="SUPPLIER-TERMS-01" value={sourceInput} onChange={e => setSourceInput(e.target.value)} /></Field><Field label="Source title"><input required minLength={2} maxLength={160} value={sourceTitle} onChange={e => setSourceTitle(e.target.value)} /></Field><Field label="Original evidence" hint="Paste the actual source text. Publisher identity does not establish that its real-world claims are true."><textarea required minLength={20} maxLength={8192} rows={5} value={sourceText} onChange={e => setSourceText(e.target.value)} /></Field><Button className="nw-button primary" disabled={disabled || !contract}>Publish source</Button></form> : <><div className="nw-live-source-record"><strong>{record.source.title} · v{record.source.revision}</strong><p>{record.source.versions.at(-1)!.text}</p><small>This source has been read from finalized contract state. Continue with it, or publish a correction below.</small></div><form onSubmit={form(() => write("revise_source",[sourceId,BigInt(record.source.revision),correction]))}><Field label={`Corrected source · next revision v${record.source.revision + 1}`} hint="This fences all unconsumed permits. Existing outputs remain in history."><textarea required minLength={20} maxLength={8192} rows={5} value={correction} onChange={e => setCorrection(e.target.value)} /></Field><Button className="nw-button primary" disabled={disabled || !isPublisher}>Publish correction</Button>{!isPublisher && <p className="nw-muted">Connect the source publisher wallet to make corrections.</p>}</form><form className="nw-separated" onSubmit={form(() => write("approve_workflow_owner",[sourceId,approvedOwner]))}><Field label="Approve another workflow owner" hint="Approved owners can register independent workflows against this source."><input required pattern="0x[a-fA-F0-9]{40}" placeholder="Owner wallet address" value={approvedOwner} onChange={e => setApprovedOwner(e.target.value)} /></Field><Button className="nw-button" variant="outline" disabled={disabled || !isPublisher}>Approve owner</Button></form><details className="nw-details"><summary>{record.source.approved_owners.length} approved owner accounts</summary>{record.source.approved_owners.map(a => <code className="nw-hash" key={a}>{a}</code>)}</details></>}</section>
        </div><section className="nw-form-card nw-job-editor"><div className="nw-form-title"><span>03</span><div><h3>Register protected jobs</h3><p>A workflow has its own owner and registered executor.</p></div></div><form onSubmit={form(async () => { await write("register_workflow",[workflowId,workflowTitle,sourceId,BigInt(record!.source.revision),executor,JSON.stringify(jobs)]); })}><div className="nw-fields"><Field label="Workflow ID"><input required minLength={2} maxLength={80} pattern="[A-Za-z0-9_.-]+" placeholder="PROCUREMENT-01" value={workflowId} onChange={e => setWorkflowId(e.target.value)} /></Field><Field label="Workflow name"><input required minLength={2} maxLength={160} value={workflowTitle} onChange={e => setWorkflowTitle(e.target.value)} /></Field></div><Field label="Executor wallet" hint="Only this account can run permitted jobs. It may be your wallet or a separate agent account."><input required pattern="0x[a-fA-F0-9]{40}" value={executor} onChange={e => setExecutor(e.target.value)} placeholder="0x…" /></Field>{jobs.map((j,i) => <fieldset className="nw-job-fields" key={i}><legend>JOB {i + 1}</legend>{jobs.length > 1 && <button type="button" className="nw-remove" aria-label={`Remove job ${i + 1}`} onClick={() => setJobs(jobs.filter((_,k) => i !== k))}><Trash2 size={15} /></button>}<div className="nw-fields"><Field label="Job ID"><input required minLength={2} maxLength={80} pattern="[A-Za-z0-9_.-]+" value={j.id} onChange={e => updateJob(i,{ id:e.target.value })} /></Field><Field label="Job name"><input required minLength={2} maxLength={160} value={j.label} onChange={e => updateJob(i,{ label:e.target.value })} /></Field></div><Field label="Condition that must remain true"><textarea required minLength={10} maxLength={1200} rows={2} value={j.condition} onChange={e => updateJob(i,{condition:e.target.value})} /></Field><div className="nw-fields"><Field label="Protected tool"><select value={j.tool} onChange={e => { const tool=e.target.value as JobInput['tool']; updateJob(i,{ tool,payload:tool === "prepare_price_report" ? {unit_price:j.payload.unit_price,currency:j.payload.currency} : {...j.payload,quantity:1,shipping:"standard"} }); }}><option value="prepare_purchase_order">Purchase-order draft</option><option value="prepare_price_report">Price report</option></select></Field><Field label="Target"><input required minLength={2} maxLength={120} value={j.target} onChange={e => updateJob(i,{target:e.target.value})} /></Field></div><div className="nw-fields"><Field label="Unit price" hint="Whole currency units."><input required type="number" min={1} max={100000000} step={1} value={j.payload.unit_price || ""} onChange={e => updateJob(i,{payload:{...j.payload,unit_price:Number(e.target.value)}})} /></Field><Field label="Currency"><input required minLength={3} maxLength={3} pattern="[A-Z]{3}" value={j.payload.currency} onChange={e => updateJob(i,{payload:{...j.payload,currency:e.target.value.toUpperCase()}})} /></Field></div>{j.tool === "prepare_purchase_order" && <div className="nw-fields"><Field label="Quantity"><input required type="number" min={1} max={10000} step={1} value={j.payload.quantity} onChange={e => updateJob(i,{payload:{...j.payload,quantity:Number(e.target.value)}})} /></Field><Field label="Shipping"><select value={j.payload.shipping} onChange={e => updateJob(i,{payload:{...j.payload,shipping:e.target.value as 'express' | 'standard'}})}><option value="standard">Standard</option><option value="express">Express</option></select></Field></div>}</fieldset>)}<div className="nw-actions"><Button type="button" variant="outline" className="nw-button" disabled={jobs.length >= 3} onClick={() => setJobs([...jobs,jobInput(`job-${jobs.length + 1}`)])}><Plus size={15} />Add job</Button><Button className="nw-button primary" disabled={disabled || !record || !account || !record.source.approved_owners.includes(account) || record.source.workflow_ids.length >= 4}>Register workflow <ArrowRight size={15} /></Button></div><p className="nw-muted">Connect an approved owner wallet. Up to 4 workflows per source and 3 jobs per workflow.</p></form><details className="nw-details"><summary>Advanced · inspect or import job JSON</summary><p>Forms are the default editor. Imported jobs must use the same supported tools and fields.</p><textarea aria-label="Advanced job JSON" rows={5} value={advancedJson || JSON.stringify(jobs,null,2)} onChange={e => setAdvancedJson(e.target.value)} /><Button className="nw-button" variant="outline" onClick={() => void run(async () => { const parsed=JSON.parse(advancedJson || JSON.stringify(jobs)); if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 3 || parsed.some(j => !j || typeof j.id !== "string" || typeof j.label !== "string" || typeof j.condition !== "string" || typeof j.target !== "string" || !['prepare_purchase_order','prepare_price_report'].includes(j.tool) || !j.payload || !Number.isInteger(j.payload.unit_price) || typeof j.payload.currency !== "string")) throw new Error("Use 1–3 jobs matching the form schema."); setJobs(parsed);setAdvancedJson("");setNotice("Imported jobs are ready to review in the form."); })}>Apply JSON to form</Button></details></section></div>}</section>}

      {live && liveStep < 3 && <div className="nw-live-next"><p>{liveStep === 0 ? canAdvance ? "Contract verified. Ready for the shared source." : "Verify an existing contract and Source ID to read a record, or connect a wallet to create new work." : liveStep === 1 ? record ? `Source v${record.source.revision} is available. Continue to protected jobs.` : "Publish or load a source before continuing." : items.length ? `${items.length} registered jobs are ready to inspect.` : "Register at least one workflow before continuing."}</p><Button className="nw-button primary" disabled={disabled || !canAdvance} onClick={() => goToStage(liveStep + 1)}>Continue to {liveStages[liveStep + 1].toLowerCase()} <ArrowRight size={16} /></Button></div>}
      {runComplete && <section className="nw-live-complete" role="status"><h2>Current revision resolved.</h2><p>{completed} {completed === 1 ? "output" : "outputs"} created · {blocked + uncertain} {blocked + uncertain === 1 ? "job" : "jobs"} held. View the complete record for source history, review decisions, permissions and outputs. A source correction starts a new review.</p><Button className="nw-button" variant="outline" onClick={openAudit}>Inspect complete record <Fingerprint size={16} /></Button></section>}

      {tab === "audit" && <section><div className="nw-section-heading"><div><div className="nw-eyebrow">EVIDENCE / PERMISSION / OUTPUT</div><h2>Every consequence has a record.</h2><p>{live ? "Inspect finalized records, download a report, or publish a signed snapshot." : "These are simulated records. Open a live workspace to verify or publish network evidence."}</p></div>{bundle && <div className="nw-actions nw-audit-actions"><Button className="nw-button" variant="outline" disabled={busy} onClick={() => void run(() => exportAudit(true))}><FileText size={15} />Readable report</Button><Button className="nw-button" variant="outline" disabled={busy} onClick={() => void run(() => exportAudit())}><Download size={15} />JSON package</Button>{live && <NetworkArchive draft={draft} publication={publication} consent={archiveConsent} busy={busy} disabled={disabled} error={error} activity={archiveActivity} onConsent={setArchiveConsent} onPrepare={() => void run(prepareArchive)} onPublish={() => void run(publishArchive)} onVerify={() => void run(async () => { archiveProgress("Checking the gateway response against the signed snapshot…"); if (publication) storePublication(await verifyArchiveRetrieval(publication)); })} />}</div>}</div>{!bundle ? <div className="nw-empty"><Fingerprint size={30} /><p>Load a shared source to inspect its record.</p></div> : <div className="nw-audit-grid nw-audit-compact"><div><section className="nw-form-card"><div className="nw-panel-label"><Layers3 size={15} />SOURCE HISTORY</div>{bundle.source.versions.map(v => <details className="nw-history" key={v.revision}><summary><span className="nw-revision">v{v.revision}</span><strong>{v.revision === 1 ? "Original evidence" : "Publisher correction"}</strong><span>{v.revision === bundle.source.revision ? "Current" : "Historical"}</span></summary><p>{v.text}</p><code className="nw-hash">SHA-256 {v.sha256}</code></details>)}</section>{bundle.workflows.map(w => <section className="nw-form-card" key={w.id}><div className="nw-panel-label"><GitBranch size={15} />{w.title}</div><p className="nw-muted">Owner {short(w.owner)} · executor {short(w.executor)}</p>{w.actions.map(a => <details className="nw-history" key={a.id}><summary><strong>{a.label}</strong><span className={`nw-status ${tone(a)}`}>{status(a)}</span></summary><p>{a.condition}</p><code className="nw-hash">Intent {a.intent_hash}</code>{a.permits.map(p => <div className="nw-permit-line" key={p.id}><span>Permit · v{p.revision}</span><strong>{a.execution?.permit_id === p.id ? "Consumed" : p.revision !== bundle.source.revision ? "Superseded" : a.active_permit?.id === p.id ? "Active" : "Inactive"}</strong><code className="nw-hash">{p.id}</code></div>)}{a.execution && <><p>Output created at v{a.execution.revision}. Later source revisions do not reverse it.</p><Button className="nw-button" variant="outline" onClick={() => downloadFile(`${live ? "" : "SIMULATED-"}${w.id}-${a.id}.json`,a.execution!.output_json)}><Download size={14} />Download output</Button></>}<details className="nw-details"><summary>Review history</summary>{w.reviews.map(r => { const row=r.actions.find(x => x.id === a.id);return <div className="nw-permit-line" key={r.revision}><strong>v{r.revision} · {row?.verdict.replaceAll("_"," ")}</strong><p>{row?.reason}</p></div>; })}</details></details>)}<details className="nw-details"><summary>{w.attempts.length} permission and execution checks</summary><div className="nw-table-wrap"><table><thead><tr><th>Job / operation</th><th>Requested / current</th><th>Result</th></tr></thead><tbody>{w.attempts.map(a => <tr key={a.index}><td>{a.action_id}<small>{a.operation}</small></td><td>v{a.requested_revision} / v{a.current_revision}</td><td>{a.code.replaceAll("_"," ")}</td></tr>)}</tbody></table></div></details></section>)}</div><details className="nw-details nw-audit-verification"><summary><ShieldCheck size={16} />Verification & execution details</summary><div className="nw-audit-verification-content"><section className="nw-form-card nw-audit-summary"><Fingerprint size={26} /><h3>Independently checkable.</h3><p>Source bytes, job intent and output each have their own SHA-256 digest. The contract records the revision, permission and executor together.</p><div><small>DECISION AUTHORITY</small><strong>{live ? "GenLayer Studionet" : "Simulated review responses"}</strong></div><div><small>READ STATE</small><strong>{live ? "Latest finalized" : "Local sample snapshots"}</strong></div>{live && <div><small>CONTRACT</small><code className="nw-hash">{contract}</code></div>}<p className="nw-fine">An exported JSON snapshot is not a cryptographic chain proof. Verify a live record by reading the stated contract again.</p></section><section className="nw-scope-note"><strong>What execution means here</strong><p>Protected tools generate a purchase-order draft or price report inside the contract. They do not send a supplier order, transfer funds or prove delivery.</p>{live && <a href="./?legacy=1">Open the earlier v1 workspace <ArrowUpRight size={13} /></a>}</section></div></details></div>}</section>}
    </main>
    {live && <NetworkActivity progress={progress} pending={pending} busy={busy} error={error} notice={notice} operation={operation} dismissed={activityDismissed} onDismiss={() => setActivityDismissed(true)} onRecover={() => void run(recoverTransaction)} />}
    <footer className="nw-footer"><span><ShieldCheck size={16} />ProofGuard Change</span><p>Evidence changes. Permission adapts.</p><div><a href="https://genlayer.com" target="_blank" rel="noreferrer">Built for GenLayer <ArrowUpRight size={13} /></a><span>Autonomous Protocols</span></div></footer>
  </div>;
}

function EvidenceSources({ original, current, review, kind }: {
  original: { text: string; revision: number }; current: { text: string; revision: number };
  review?: { old_quote: string; new_quote: string }; kind: string;
}) {
  const sameText = original.text === current.text;
  const sameExcerpt = sameText && review?.old_quote === review?.new_quote;
  return <div className="nw-evidence-sources">
    {review && (review.old_quote || review.new_quote) && <div className={`nw-source-comparison nw-excerpts ${sameExcerpt ? "nw-single-source" : ""}`}>
      {!sameExcerpt && <div><span>ORIGINAL EXCERPT <b>v{original.revision}</b></span><p>{review.old_quote ? <mark className="before">{review.old_quote}</mark> : "No supporting excerpt was identified."}</p></div>}
      <div><span>{sameExcerpt ? "EXACT SOURCE EXCERPT" : "CURRENT EXCERPT"} <b>v{current.revision}</b></span><p>{review.new_quote ? <mark className={kind}>{review.new_quote}</mark> : "No supporting excerpt was identified."}</p></div>
    </div>}
    <details className="nw-details nw-full-evidence">
      <summary>{sameText ? "Read full source" : "Compare full source texts"}<span className="nw-evidence-meta">{sameText ? original.revision === current.revision ? `Original and current · v${current.revision}` : `Text unchanged · v${original.revision} → v${current.revision}` : `v${original.revision} → v${current.revision}`}</span></summary>
      <div className={`nw-source-comparison ${sameText ? "nw-single-source" : ""}`}>
        {!sameText && <div><span>ORIGINAL SOURCE <b>v{original.revision}</b></span><p><Marked text={original.text} quote={review?.old_quote} kind="before" /></p></div>}
        <div><span>{sameText ? "SHARED SOURCE" : "CURRENT SOURCE"} <b>v{current.revision}</b></span><p><Marked text={current.text} quote={review?.new_quote} kind={kind} /></p></div>
      </div>
    </details>
  </div>;
}

function JobDetails({ live, workflow, job, account, disabled, processing = false, operation, onAuthorize, onExecute }: { live: boolean; workflow: NetworkWorkflow; job: NetworkJob; account: string; disabled: boolean; processing?: boolean; operation?: string; onAuthorize: () => void; onExecute: () => void }) {
  const intent=JSON.parse(job.intent_json);
  return <div className="nw-job-details"><div className="nw-tool-line"><FileText size={16} /><span>{intent.tool === "prepare_purchase_order" ? "Purchase-order draft" : "Price report"}<small>{intent.target} · {intent.payload.currency} {intent.payload.unit_price} / unit{intent.payload.quantity ? ` · ${intent.payload.quantity} units` : ""}</small></span></div>{job.execution ? <div className="nw-output"><div><FileCheck2 size={18} /><strong>Artifact created</strong><span>v{job.execution.revision}</span></div><p>{JSON.parse(job.execution.output_json).notice}</p><Button className="nw-button" variant="outline" onClick={() => downloadFile(`${live ? "" : "SIMULATED-"}${workflow.id}-${job.id}.json`,job.execution!.output_json)}><Download size={15} />Download {live ? "output" : "sample output"}</Button><small className="nw-download-hint">JSON file · this job’s generated result</small><code className="nw-hash">SHA-256 {job.execution.output_sha256}</code></div> : live ? job.gate === "READY" ? <><div className="nw-actions"><Button className="nw-button primary" disabled={disabled || account !== workflow.owner || !!job.active_permit} onClick={onAuthorize}>{processing && operation === "authorize_action" && <LoaderCircle className="nw-spin" size={15} />}{processing && operation === "authorize_action" ? "Recording permission…" : job.active_permit ? "Permission recorded" : "Authorize this job"}</Button><Button className="nw-button" variant="outline" disabled={disabled || account !== workflow.executor || !job.active_permit} onClick={onExecute}>{processing && operation === "execute_action" ? <><LoaderCircle className="nw-spin" size={15} />Generating output…</> : <>Generate output <ArrowRight size={14} /></>}</Button></div><p className="nw-fine">The workflow owner authorizes. The registered executor generates the output. Current revision and intent are checked again at execution.</p></> : <p className="nw-fine">This job cannot receive a permit until a current review supports its condition.</p> : <p className="nw-fine">{job.active_permit ? "An original permit is present in this sample state." : job.gate === "READY" ? "This job can receive a new permit for the current revision." : "No output can be created from this sample state."}</p>}<details className="nw-details"><summary>Exact intent & permission history</summary><pre>{JSON.stringify(intent,null,2)}</pre><code className="nw-hash">Intent SHA-256 {job.intent_hash}</code>{job.permits.map(p => <p key={p.id}>v{p.revision} · {job.execution?.permit_id === p.id ? "Consumed" : job.active_permit?.id === p.id ? "Active" : "Superseded or inactive"} · {short(p.id)}</p>)}</details></div>;
}
