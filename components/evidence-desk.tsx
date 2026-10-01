"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronRight, Code2, Copy, Download, FileCheck2, Fingerprint, GitBranch, LoaderCircle, LockKeyhole, RefreshCw, Search, ShieldCheck, Terminal, Wallet } from "lucide-react";
import { ProjectBrand } from "./change-home";
import { EVIDENCE_NETWORKS, EVIDENCE_REFERENCES, PROOFGUARD_REPOSITORY, evidenceUrl, type EvidenceConnection, type EvidenceNetwork } from "@/config/evidence-desk";
import { createBrowserInspector, inspectionError, type EvidenceSnapshot } from "@/genlayer/evidence-desk-client";
import type { NetworkJob } from "@/genlayer/change-network-client";
import { DownloadLink } from "./download-link";
import { PUBLIC_APP_URL } from "@/config/public-site";

const phaseLabels = ["Network", "Contract code", "Finalized record", "Integrity"];
const phaseIndex = (phase: string) => phase.includes("bindings") ? 3 : phase.includes("evidence") ? 2 : phase.includes("code") ? 1 : 0;
function state(job: NetworkJob, revision: number) {
  if (job.execution) return { name: job.execution.revision === revision ? "Output created" : "Historical output", tone: "mint", instruction: "Inspect the generated artifact and the permission that produced it." };
  if (job.gate === "MATERIAL_CHANGE") return { name: "Condition changed", tone: "amber", instruction: "This job stays held. Its condition is no longer supported by the current evidence." };
  if (job.gate === "INSUFFICIENT_EVIDENCE") return { name: "Evidence needed", tone: "lilac", instruction: "The source does not establish this condition. The publisher needs to supply relevant evidence before another review." };
  if (job.gate === "READY") return { name: job.active_permit ? "Permit available" : "Owner approval needed", tone: "mint", instruction: job.active_permit ? "The registered executor can request contract execution. The contract checks the revision and permission again." : "The review supports this job. The workflow owner still needs to authorize it." };
  return { name: "Review needed", tone: "lilac", instruction: "This revision has not established a usable decision for this job. Request a review in the Live workspace." };
}

function initialConnection(): EvidenceConnection {
  const p = new URLSearchParams(window.location.search);
  const reference = EVIDENCE_REFERENCES.find(r => r.id === p.get("reference"));
  return reference ? { ...reference } : { network: p.get("network") === "studio-next" ? "studio-next" : "studionet", contract: p.get("contract") || "", sourceId: p.get("source") || "" };
}

export function EvidenceDesk() {
  const [connection, setConnection] = useState<EvidenceConnection>(initialConnection);
  const [loadedConnection, setLoadedConnection] = useState<EvidenceConnection | null>(null);
  const [snapshot, setSnapshot] = useState<EvidenceSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [sourceExpanded, setSourceExpanded] = useState(true);
  const [phase, setPhase] = useState("");
  const [failure, setFailure] = useState<ReturnType<typeof inspectionError> | null>(null);
  const [selected, setSelected] = useState("");
  const [section, setSection] = useState<"decisions" | "history" | "connect">("decisions");
  const [toast, setToast] = useState("");
  const [tool, setTool] = useState("proofguard_inspect_workflow");
  const [expectedRevision, setExpectedRevision] = useState(1);
  const [testResult, setTestResult] = useState<{ ok: boolean; data: unknown; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [checkoutPath, setCheckoutPath] = useState("/absolute/path/proofguard-change");
  const sequence = useRef(0);
  const items = snapshot?.bundle.workflows.flatMap(w => w.actions.map(a => ({ w, a, key: `${w.id}/${a.id}` }))) || [];
  const focus = items.find(item => item.key === selected) || items[0];
  const activeReference = loadedConnection && EVIDENCE_REFERENCES.find(r => r.network === loadedConnection.network && r.contract.toLowerCase() === loadedConnection.contract.toLowerCase() && r.sourceId === loadedConnection.sourceId);
  const revision = snapshot?.source.revision || 0;
  const review = focus?.w.reviews.find(r => r.revision === revision)?.actions.find(a => a.id === focus.a.id);
  const status = focus && state(focus.a, revision);
  const network = EVIDENCE_NETWORKS[connection.network];
  const loadedNetwork = loadedConnection && EVIDENCE_NETWORKS[loadedConnection.network];
  const counts = { output: items.filter(x => x.a.execution).length, held: items.filter(x => ["MATERIAL_CHANGE", "INSUFFICIENT_EVIDENCE"].includes(x.a.gate)).length, review: items.filter(x => x.a.gate === "AWAITING_REVIEW").length };

  async function load(next = connection) {
    const request = ++sequence.current;
    setConnection(next); setSnapshot(null); setLoadedConnection(null); setFailure(null); setTestResult(null); setToast(""); setBusy(true);
    try {
      const inspector = await createBrowserInspector(next, message => { if (request === sequence.current) setPhase(message); });
      const result = await inspector.inspectSource() as EvidenceSnapshot;
      if (request !== sequence.current) return;
      setSnapshot(result); setSourceExpanded(false); setLoadedConnection({ ...next }); setExpectedRevision(result.source.revision);
      const all = result.bundle.workflows.flatMap(w => w.actions.map(a => ({ w, a })));
      const chosen = all.find(x => !x.a.execution) || all[0];
      setSelected(chosen ? `${chosen.w.id}/${chosen.a.id}` : "");
      window.history.replaceState(null, "", evidenceUrl(next));
    } catch (error) { if (request === sequence.current) setFailure(inspectionError(error)); }
    finally { if (request === sequence.current) setBusy(false); }
  }
  useEffect(() => {
    const initial = initialConnection();
    if (initial.contract && initial.sourceId) void load(initial);
    return () => { sequence.current++; };
    // URL is the initial connection, never a signing request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 5000); return () => clearTimeout(timer); }, [toast]);
  function edit(update: Partial<EvidenceConnection>) {
    sequence.current++; setBusy(false); setSnapshot(null); setLoadedConnection(null); setFailure(null); setTestResult(null); setConnection(c => ({ ...c, ...update }));
  }
  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setToast(`${label} copied.`); }
    catch { setToast("Clipboard is unavailable. Select and copy the visible text instead."); }
  }
  function submit(e: FormEvent) { e.preventDefault(); void load(); }
  const mcpConfig = loadedConnection ? JSON.stringify({ mcpServers: { proofguard: { command: "node", args: [`${checkoutPath.replace(/[\\/]+$/, "")}/agents/mcp-server.mjs`, "--network", loadedConnection.network, "--contract", loadedConnection.contract, "--source", loadedConnection.sourceId] } } }, null, 2) : "";
  const toolArguments = tool === "proofguard_list_workflows" ? {} : { workflowId: focus?.w.id, ...(tool === "proofguard_get_output" ? { jobId: focus?.a.id } : {}), expectedRevision };
  async function testRead() {
    if (!loadedConnection || (tool !== "proofguard_list_workflows" && !focus) || testing) return;
    setTesting(true); setTestResult(null);
    try {
      const inspector = await createBrowserInspector(loadedConnection);
      const args = { workflowId: focus?.w.id, jobId: focus?.a.id, expectedRevision };
      const result = tool === "proofguard_list_workflows" ? await inspector.listWorkflows() : tool === "proofguard_get_output" ? await inspector.getOutput(args) : await inspector.inspectWorkflow(args);
      setTestResult({ ok: true, data: result, message: "Fresh finalized read completed. This read submitted no transaction." });
    } catch (error) {
      const problem = inspectionError(error);
      setTestResult({ ok: false, data: { error: problem.code, state: "UNKNOWN" }, message: problem.message });
    } finally { setTesting(false); }
  }
  const attempts = snapshot?.bundle.workflows.flatMap(w => w.attempts.map(a => ({ ...a, workflow: w.id }))) || [];

  return <div className="pg-site ed-app">
    <a href="#evidence-main" className="pg-skip">Skip to evidence</a>
    <header className="ed-header"><ProjectBrand /><nav aria-label="Application navigation"><a href="./?mode=inspect" aria-current="page">Evidence Desk</a><a href="./?mode=demo">Demo</a><a className="ed-live-link" href="./?mode=live"><Wallet size={15} />Live workspace <ArrowUpRight size={14} /></a></nav></header>
    <main id="evidence-main" className="ed-main">
      <div className="ed-intro"><div><span className="ed-eyebrow">EVIDENCE DESK / READ ONLY</span><h1>See what the evidence permits.</h1><p>Inspect a real record. Understand each decision. Connect your agent.</p></div><span className="ed-no-wallet"><ShieldCheck size={17} />No wallet. No signing.</span></div>
      <section className="ed-connect" aria-label="Select a source">
        {snapshot && <div className="ed-source-summary"><div><span className="ed-eyebrow">CONNECTED SOURCE</span><strong>{loadedConnection?.sourceId}</strong><small>{loadedNetwork?.name}</small></div><button className="ed-button" disabled={testing} aria-expanded={sourceExpanded} aria-controls="source-fields" onClick={() => setSourceExpanded(v => !v)}>{sourceExpanded ? "Hide source settings" : "Change source"}</button></div>}
        <div id="source-fields" hidden={!!snapshot && !sourceExpanded}>
        <form onSubmit={submit}><label>Network<select value={connection.network} disabled={busy || testing} onChange={e => edit({ network: e.target.value as EvidenceNetwork })}><option value="studionet">Studionet · 61999</option><option value="studio-next">Studio Next · 61997</option></select></label><label>ProofGuard v2 contract<input required pattern="0x[a-fA-F0-9]{40}" title="0x followed by 40 hexadecimal characters" value={connection.contract} placeholder="0x…" disabled={busy || testing} onChange={e => edit({ contract: e.target.value })} spellCheck={false} /></label><label>Source ID<input required pattern="[A-Za-z0-9_.\-]{2,80}" title="2–80 letters, numbers, dots, underscores or hyphens" value={connection.sourceId} placeholder="Your registered Source ID" disabled={busy || testing} onChange={e => edit({ sourceId: e.target.value })} spellCheck={false} /></label><button className="ed-button ed-dark" disabled={busy || testing}>{busy ? <LoaderCircle className="ed-spin" size={17} /> : <Search size={17} />}{busy ? "Checking…" : "Inspect record"}</button></form>
        <div className="ed-reference-row"><span>Try a real test record</span>{EVIDENCE_REFERENCES.map(r => <button disabled={busy || testing} key={r.id} onClick={() => { setSection("decisions"); void load({ ...r }); }}>{r.id === "correction" ? "Source correction" : "Policy distinction"}<ArrowUpRight size={13} /></button>)}</div></div>
      </section>
      {busy && <section className="ed-verification ed-working" role="status" aria-live="polite"><div><LoaderCircle className="ed-spin" size={21} /><strong>{phase || "Opening the reader"}</strong><span>Reading {network.name}. No wallet request will appear.</span></div><ol>{phaseLabels.map((label, i) => <li key={label} className={i <= phaseIndex(phase) ? "active" : ""}>{i < phaseIndex(phase) ? <Check size={14} /> : <span>{i + 1}</span>}{label}</li>)}</ol></section>}
      {failure && <section className="ed-error" role="alert"><LockKeyhole size={24} /><div><h2>We could not establish a current result.</h2><p>{failure.message}</p><code>{failure.code}</code></div><button className="ed-button" onClick={() => void load()}>Try again <RefreshCw size={15} /></button></section>}
      {!busy && !snapshot && !failure && <section className="ed-empty"><Fingerprint size={35} /><h2>Start with evidence you can inspect.</h2><p>Choose a test record above, or enter your own deployed ProofGuard v2 contract and Source ID. Every result is read from the selected network and checked in your browser.</p><div className="ed-empty-steps"><span>01 · Code match</span><span>02 · Finalized state</span><span>03 · Evidence & output checks</span></div></section>}
      {snapshot && loadedConnection && loadedNetwork && <>
        <section className="ed-verification ed-verified"><div><CheckCheck size={22} /><strong>Record read. Integrity checks passed.</strong><span>{loadedNetwork.name} · source v{revision} · read {new Date(snapshot.observedAt).toLocaleTimeString()}</span><button disabled={testing} onClick={() => void load(loadedConnection)} aria-label="Refresh finalized record"><RefreshCw size={17} /></button></div><details><summary>What was checked?</summary><p>Network ID, exact contract code, finalized source history, intent hashes, current permit bindings and existing output contents. This trusts the selected RPC; it is not a light-client proof or verification of the publisher’s real-world claims.</p><code>Contract SHA-256 · {snapshot.contractCodeSha256}</code><span>Observed {new Date(snapshot.observedAt).toISOString()}. Refresh before relying on newer state.</span></details></section>
        <div className="ed-record-title"><div><span className="ed-eyebrow">{activeReference ? "REAL NETWORK · CONTROLLED TEST RECORD" : "FINALIZED SOURCE SNAPSHOT"}</span><h2>{snapshot.source.title}</h2>{activeReference && <p>{activeReference.description}</p>}</div><div className="ed-record-links"><a href={`${loadedNetwork.explorer}/address/${loadedConnection.contract}`} target="_blank" rel="noreferrer">Explorer <ArrowUpRight size={14} /></a><button onClick={() => void copy(new URL(evidenceUrl(loadedConnection), PUBLIC_APP_URL).toString(), "Record link")}><Copy size={14} />Share record</button><DownloadLink name={`ProofGuard-observation-${snapshot.source.id}-v${revision}.json`} text={JSON.stringify({ schema: "proofguard-evidence-desk/1", ...snapshot }, null, 2)}><Download size={14} />Snapshot</DownloadLink></div></div>
        <div className="ed-statline"><span><b>{items.length.toString().padStart(2, "0")}</b>registered jobs</span><span className="mint"><b>{counts.output.toString().padStart(2, "0")}</b>outputs in history</span><span className="amber"><b>{counts.held.toString().padStart(2, "0")}</b>jobs held</span><span><b>{revision.toString().padStart(2, "0")}</b>source revisions</span></div>
        <nav className="ed-tabs" aria-label="Evidence views">{[["decisions", "Decisions", GitBranch], ["history", "Evidence & history", Fingerprint], ["connect", "Connect an agent", Terminal]].map(([key, label, Icon]) => { const Symbol = Icon as typeof GitBranch; return <button key={String(key)} disabled={testing} aria-current={section === key ? "page" : undefined} onClick={() => { setSection(key as typeof section); setTestResult(null); }}><Symbol size={16} />{String(label)}</button>; })}</nav>
        {section === "decisions" && <div className="ed-workbench"><aside className="ed-jobs"><label className="ed-mobile-jobs">Select a job<select value={focus?.key || ""} onChange={e => { setSelected(e.target.value); setTestResult(null); }}>{items.map(x => <option key={x.key} value={x.key}>{x.a.label} · {state(x.a, revision).name}</option>)}</select></label><div className="ed-desktop-jobs"><span className="ed-eyebrow">SELECT A JOB</span>{items.length ? items.map(({ w, a, key }, index) => { const badge = state(a, revision); return <button key={key} className={`ed-job ${selected === key ? "selected" : ""}`} aria-pressed={selected === key} onClick={() => { setSelected(key); setTestResult(null); }}><span className="ed-job-no">{String(index + 1).padStart(2, "0")}</span><span><small>{w.title}</small><strong>{a.label}</strong><span className={`ed-badge ${badge.tone}`}>{badge.name}</span></span><ChevronRight size={17} /></button>; }) : <p>No workflows are registered against this source yet.</p>}<div className="ed-sidebar-note"><ShieldCheck size={19} /><p>Decisions, owner permissions and generated outputs are different steps. A favorable review alone is not execution permission.</p></div></div></aside>
          {focus && status && <article className={`ed-decision ${status.tone}`} key={focus.key}><div className="ed-decision-top"><span className={`ed-badge ${status.tone}`}>{status.name}</span><code>{focus.w.id} / {focus.a.id}</code></div><h3>{focus.a.label}</h3><p className="ed-next-action">{status.instruction}</p><div className="ed-condition"><span className="ed-eyebrow">REQUIRED CONDITION</span><p>{focus.a.condition}</p></div><section className="ed-reason"><span className="ed-eyebrow">GENLAYER REVIEW · SOURCE v{revision}</span><p>{review?.reason || "No review was recorded for this job at the current source revision."}</p>{review?.new_quote && <blockquote>“{review.new_quote}”</blockquote>}</section>
            <details className="ed-detail"><summary>Compare the evidence <span>v{focus.w.baseline_revision} → v{revision}</span></summary><div className="ed-comparison"><div><b>At registration</b><p>{review?.old_quote || snapshot.bundle.source.versions[focus.w.baseline_revision - 1]?.text}</p></div><div><b>Current evidence</b><p>{review?.new_quote || snapshot.bundle.source.versions.at(-1)?.text}</p></div></div></details>
            {focus.a.execution && <section className="ed-output"><FileCheck2 size={24} /><div><strong>{focus.a.execution.revision === revision ? "Verified contract artifact" : `Historical artifact · source v${focus.a.execution.revision}`}</strong><p>Its content and source, intent, permit and executor bindings passed inspection. No supplier order or payment was sent.</p></div><div className="ed-output-actions"><DownloadLink className="ed-button" name={`${focus.w.id}-${focus.a.id}-v${focus.a.execution.revision}.json`} text={focus.a.execution.output_json}><Download size={15} />Download output</DownloadLink><button className="ed-button" onClick={() => void copy(focus.a.execution!.output_json, "Output JSON")}><Copy size={15} />Copy JSON</button></div><details><summary>Preview artifact</summary><pre>{JSON.stringify(JSON.parse(focus.a.execution.output_json), null, 2)}</pre></details></section>}
            <details className="ed-detail"><summary>Exact intent & account roles</summary><div className="ed-binding"><span>Owner <code>{focus.w.owner}</code></span><span>Executor <code>{focus.w.executor}</code></span><span>Intent SHA-256 <code>{focus.a.intent_hash}</code></span></div><pre>{JSON.stringify(JSON.parse(focus.a.intent_json), null, 2)}</pre></details><div className="ed-decision-footer"><button onClick={() => setSection("connect")}>Read this from your agent <ArrowRight size={15} /></button>{loadedConnection.network === "studionet" && <a href={`./?mode=live&contract=${encodeURIComponent(loadedConnection.contract)}&source=${encodeURIComponent(loadedConnection.sourceId)}`}>Open Live workspace <ArrowUpRight size={15} /></a>}</div>
          </article>}
        </div>}
        {section === "history" && <div className="ed-history"><section className="ed-panel"><span className="ed-eyebrow">VERSIONED EVIDENCE</span><h3>What changed, and when it mattered.</h3>{snapshot.bundle.source.versions.map(v => <details className="ed-version" key={v.revision} open={v.revision === revision}><summary><b>v{v.revision}</b>{v.revision === revision ? "Current source" : "Earlier source"}<span>{v.revision === revision ? "Current" : "History"}</span></summary><p>{v.text}</p><code>SHA-256 · {v.sha256}</code></details>)}</section><section className="ed-panel"><span className="ed-eyebrow">CONTRACT ATTEMPTS</span><h3>Permission has a trace.</h3><p className="ed-muted">These are recorded authorization and execution checks, not a count of all network transactions.</p><div className="ed-attempts">{attempts.length ? attempts.map((a, i) => <div key={`${a.workflow}-${i}`}><span className={`ed-attempt-dot ${a.allowed ? "allowed" : "denied"}`} /><div><strong>{a.code.replaceAll("_", " ").toLowerCase()}</strong><small>{a.workflow} / {a.action_id} · {a.operation}</small><small>Requested v{a.requested_revision} · current v{a.current_revision}</small></div><span>{a.allowed ? "Allowed" : "Rejected"}</span></div>) : <p>No authorization or execution attempts are recorded.</p>}</div></section></div>}
        {section === "connect" && <div className="ed-integration"><section className="ed-panel"><span className="ed-eyebrow">01 / CONNECT YOUR CLIENT</span><h3>Give your agent a record it can inspect.</h3><p className="ed-muted">The experimental MCP connector reads this network and source. It has no signing key and cannot authorize or execute jobs.</p><ol className="ed-install"><li>Clone the repository, check out <code>feature/evidence-desk</code>, and run <code>npm ci</code> with Node.js 22.13+.</li><li>Set your checkout path below, then add the configuration to an MCP client.</li><li>Ask it to inspect the selected job and explain the evidence behind the result.</li></ol><label className="ed-path">Local repository path<input value={checkoutPath} onChange={e => setCheckoutPath(e.target.value)} placeholder="/absolute/path/proofguard-change" /></label><div className="ed-code-head"><span>mcpServers configuration</span><button onClick={() => void copy(mcpConfig, "MCP configuration")}><Copy size={14} />Copy</button></div><pre>{mcpConfig}</pre><div className="ed-record-links"><a href={PROOFGUARD_REPOSITORY} target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={14} /></a><a href={`${PROOFGUARD_REPOSITORY}/blob/feature/evidence-desk/docs/EVIDENCE_DESK.md`} target="_blank" rel="noreferrer">Integration guide <ArrowUpRight size={14} /></a></div></section>
          <section className="ed-panel ed-read-lab"><span className="ed-eyebrow">02 / TRY THE READ CONTRACT</span><h3>Check what your agent would receive.</h3><p className="ed-muted">This browser calls the same read-only inspector as the MCP connector, directly over RPC. It does not run an AI agent or an MCP session.</p><label>Read operation<select value={tool} disabled={testing} onChange={e => { setTool(e.target.value); setTestResult(null); }}><option value="proofguard_inspect_workflow">Inspect workflow</option><option value="proofguard_list_workflows">List workflows</option><option value="proofguard_get_output">Retrieve output</option></select></label>{items.length > 0 && <label>Job<select value={focus?.key || ""} disabled={testing} onChange={e => { setSelected(e.target.value); setTestResult(null); }}>{items.map(x => <option key={x.key} value={x.key}>{x.a.label}</option>)}</select></label>}{tool !== "proofguard_list_workflows" && <label>Expected source revision<input type="number" min={1} max={16} required value={expectedRevision} disabled={testing} onChange={e => { setExpectedRevision(Number(e.target.value)); setTestResult(null); }} /><small>Try an earlier revision to see the stale-source check reject it.</small></label>}<pre>{JSON.stringify({ tool, arguments: toolArguments }, null, 2)}</pre><button className="ed-button ed-dark" disabled={testing || (tool !== "proofguard_list_workflows" && (!focus || !Number.isInteger(expectedRevision) || expectedRevision < 1 || expectedRevision > 16))} onClick={() => void testRead()}>{testing ? <LoaderCircle size={16} className="ed-spin" /> : <Terminal size={16} />}{testing ? "Reading finalized state…" : "Run read-only check"}</button>{testResult && <section className={`ed-test-result ${testResult.ok ? "success" : "failure"}`} role="status"><strong>{testResult.ok ? "Read completed" : "No usable result returned"}</strong><p>{testResult.message}</p><details open={!testResult.ok}><summary>Response JSON</summary><pre>{JSON.stringify(testResult.data, null, 2)}</pre></details></section>}</section></div>}
        <footer className="ed-trust"><ShieldCheck size={17} /><p>Reads establish what the contract reports at the displayed time. Execution must recheck its current state. External tools need their own enforcement.</p><a href={`${PROOFGUARD_REPOSITORY}/blob/feature/evidence-desk/docs/ARCHITECTURE.md`} target="_blank" rel="noreferrer">Trust boundaries <ArrowUpRight size={13} /></a></footer>
      </>}
      <footer className="ed-footer"><span>ProofGuard / Change</span><a href={PROOFGUARD_REPOSITORY} target="_blank" rel="noreferrer"><Code2 size={14} />Open source</a><span>GenLayer decisions · inspectable consequences</span></footer>
    </main>
    {toast && <div className="ed-toast" role="status"><Check size={17} />{toast}<button onClick={() => setToast("")} aria-label="Dismiss notification">×</button></div>}
  </div>;
}
