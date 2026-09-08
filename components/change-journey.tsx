"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, FileCheck2, FileText, Fingerprint, GitBranch, LoaderCircle, LockKeyhole, Pause, Play, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectBrand } from "./change-home";
import walkthrough from "@/config/change-network-walkthrough.json";
import { advanceJourney, journeyFrame, journeySnapshot, JOURNEY_CHAPTERS, JOURNEY_DURATION } from "@/genlayer/change-journey.mjs";
import type { SourceBundle } from "@/genlayer/change-network-client";
import { downloadFile } from "@/lib/download-file";
const ChangeNetworkWorkspace = lazy(() => import("./change-network-workspace").then(m => ({ default: m.ChangeNetworkWorkspace })));

type Scenario = keyof typeof walkthrough;
export function ChangeJourney({ initialScenario = "material" }: { initialScenario?: Scenario }) {
  const [scenario, setScenario] = useState(initialScenario);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [inspect, setInspect] = useState(false);
  const frame = journeyFrame(elapsed);
  const chapter = JOURNEY_CHAPTERS[frame.chapter];
  useEffect(() => {
    if (!playing || frame.done) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = now - previous;
      previous = now;
      setElapsed(time => advanceJourney(time, delta, !document.hidden));
    }, 100);
    return () => window.clearInterval(timer);
  }, [playing, frame.done]);
  const stages = walkthrough[scenario].stages as unknown as SourceBundle[];
  const source = stages[frame.chapter === 0 ? 0 : 1].source;
  const allJobs = stages[0].workflows.flatMap(w => w.actions.map(a => ({ workflowId: w.id, jobId: a.id })));
  const rows = allJobs.map(({ workflowId, jobId }, i) => {
    const snapshot = journeySnapshot(frame, i);
    const workflow = stages[snapshot].workflows.find(w => w.id === workflowId)!;
    const job = workflow.actions.find(a => a.id === jobId)!;
    const review = workflow.reviews.find(r => r.revision === source.revision)?.actions.find(a => a.id === jobId);
    return { workflow, job, review };
  });
  const focusedIndex = selected ?? (frame.chapter === 2 ? Math.min(frame.reviewed, 2) : frame.chapter === 3 ? Math.min(frame.executed, 2) : 0);
  const focused = rows[focusedIndex];
  const held = rows.filter(({ job }) => ["MATERIAL_CHANGE", "INSUFFICIENT_EVIDENCE"].includes(job.gate)).length;
  const outputs = rows.filter(({ job }) => job.execution).length;
  function restart(next = scenario) {
    setScenario(next); setElapsed(0); setPlaying(true); setSelected(null); setInspect(false);
    const url = new URL(window.location.href); url.searchParams.set("scenario", next);
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  }
  return <div className="pg-site pg-journey">
    <header className="pg-header"><ProjectBrand /><div className="pg-session-header"><span className="pg-demo-disclosure">Demo · sample data</span><nav className="pg-mode-nav" aria-label="Workspace mode"><a href="./?mode=live">Live</a><a href="./?mode=demo" aria-current="page">Demo</a></nav></div></header>
    <main className="pg-run-main">
      <div className="pg-run-top"><a href="./" className="pg-back"><ArrowLeft size={15} />Project home</a><label className="pg-scenario"><span>Correction scenario</span><select value={scenario} onChange={e => restart(e.target.value as Scenario)}><option value="material">Delivery → dispatch</option><option value="wording">Wording only</option><option value="missing">Missing evidence</option></select></label></div>
      <ol className="pg-timeline" aria-label="Journey stages">{JOURNEY_CHAPTERS.map((s, i) => <li key={s.label} className={i < frame.chapter || frame.done ? "complete" : i === frame.chapter ? "current" : ""} aria-current={i === frame.chapter ? "step" : undefined}><span>{i < frame.chapter || frame.done ? <Check size={16} /> : String(i + 1).padStart(2, "0")}</span><strong>{s.label}</strong></li>)}</ol>
      <div className="pg-chapter-intro" key={frame.chapter}><div className="pg-overline">{frame.done ? "JOURNEY COMPLETE" : `CHAPTER ${String(frame.chapter + 1).padStart(2, "0")} / 05`}</div><h1>{frame.done ? "The right jobs moved forward." : chapter.title}</h1><p>{chapter.description}</p></div>
      <div className="pg-run-stage">
        <section className="pg-evidence-stage"><div className="pg-panel-heading"><FileText size={18} /><span>SHARED EVIDENCE</span><b>v{source.revision}</b></div><h2>Supplier delivery terms</h2><div className="pg-evidence-document" key={source.revision + scenario}><span>{source.revision === 1 ? "ORIGINAL PUBLISHED SOURCE" : "CORRECTED SOURCE"}</span><blockquote>{source.versions.at(-1)!.text}</blockquote><div><Fingerprint size={14} /><code>{source.versions.at(-1)!.sha256.slice(0, 18)}…</code><span>SHA-256</span></div></div>{source.revision > 1 && <details className="pg-original"><summary>Compare with the original evidence</summary><p>{source.versions[0].text}</p></details>}<div className={`pg-permission-state ${frame.chapter === 1 ? "fenced" : ""}`}><ShieldCheck size={23} /><div><strong>{frame.chapter === 0 ? "Three original permissions" : frame.chapter === 1 ? "Previous permissions fenced" : "Each job has its own decision"}</strong><p>{frame.chapter === 0 ? "Bound to source v1 and an exact job intent." : frame.chapter === 1 ? "Source v1 can no longer authorize a new output." : "The current evidence determines what may proceed."}</p></div></div></section>
        <section className="pg-decisions-stage" aria-label="Individual job decisions"><div className="pg-panel-heading"><GitBranch size={18} /><span>INDEPENDENT JOBS</span><b>03</b></div><div className="pg-run-jobs">{rows.map(({ job, workflow }, i) => {
          const isHeld = ["MATERIAL_CHANGE", "INSUFFICIENT_EVIDENCE"].includes(job.gate);
          const awaiting = job.gate === "AWAITING_REVIEW";
          const active = playing && !frame.done && ((frame.chapter === 2 && i === frame.reviewed) || (frame.chapter === 3 && i === frame.executed && !isHeld));
          const label = job.execution ? "Output created" : isHeld ? job.gate === "INSUFFICIENT_EVIDENCE" ? "Evidence needed" : "Held" : awaiting ? active ? "Reviewing condition" : "Waiting for review" : frame.chapter === 0 ? "Permitted at v1" : "Condition supported";
          return <button key={job.id} className={`pg-run-job ${isHeld ? "held" : job.execution ? "safe" : awaiting ? "waiting" : "ready"} ${active ? "processing" : ""} ${focusedIndex === i ? "selected" : ""}`} onClick={() => setSelected(i)} aria-pressed={focusedIndex === i}><span className="pg-job-icon">{active ? <LoaderCircle size={20} className="pg-spin" /> : job.execution ? <FileCheck2 size={20} /> : isHeld ? <LockKeyhole size={20} /> : awaiting ? <GitBranch size={20} /> : <Check size={20} />}</span><span><small>{workflow.title}</small><strong>{job.label}</strong><span>{label}</span></span><span className="pg-job-index">0{i + 1}</span></button>;
        })}</div><div className="pg-job-explanation" key={focused.job.id + focused.job.gate}><span className="pg-overline">{focused.review ? "DECISION BASIS" : "REQUIRED CONDITION"}</span><p>{focused.review?.reason || focused.job.condition}</p>{focused.review?.new_quote && <blockquote>“{focused.review.new_quote}”</blockquote>}{focused.job.execution && <Button variant="outline" className="pg-button pg-secondary" onClick={() => downloadFile(`SIMULATED-${focused.workflow.id}-${focused.job.id}.json`, focused.job.execution!.output_json)}><FileCheck2 size={16} />Download sample output</Button>}</div></section>
      </div>
      <div className="pg-run-console"><div className="pg-console-copy" role="status">{frame.done ? <Check size={19} /> : playing ? <span className="pg-progress-dot" /> : <Pause size={17} />}<span><strong>{frame.done ? `${outputs} outputs created · ${held} jobs held` : playing ? chapter.label : "Journey paused"}</strong><small>{frame.done ? "Run finished. Nothing else will execute." : "Stages advance automatically. Pause whenever you want to inspect."}</small></span></div><div className="pg-playback"><span>{String(Math.floor(elapsed / 1000)).padStart(2, "0")} / {Math.ceil(JOURNEY_DURATION / 1000)} sec</span><Button variant="outline" className="pg-button pg-secondary pg-restart" aria-label="Restart journey" onClick={() => restart()}><RotateCcw size={18} /></Button><Button className="pg-button pg-primary" onClick={() => frame.done ? restart() : setPlaying(!playing)}>{frame.done ? <><Play size={17} />Replay journey</> : playing ? <><Pause size={17} />Pause</> : <><Play size={17} />Continue</>}</Button></div><div className="pg-run-progress" role="progressbar" aria-label="Demo journey progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frame.progress * 100)}><span style={{ width: `${frame.progress * 100}%` }} /></div></div>
      {frame.done && <section className="pg-run-finish"><div><span className="pg-overline">END OF RUN</span><h2>{scenario === "wording" ? "The words changed. The conditions held." : "A held job. A working system."}</h2><p>{scenario === "missing" ? "Missing evidence keeps the urgent job on hold. Supported jobs still produce their artifacts." : scenario === "wording" ? "All three jobs remain supported and produce their artifacts after fresh permissions." : "The event order was held. The stock-order draft and price report were created. No supplier order or payment was submitted."}</p></div><div className="pg-finish-actions"><Button className="pg-button pg-primary" onClick={() => setInspect(!inspect)}><Fingerprint size={17} />{inspect ? "Close complete record" : "Inspect complete record"}</Button><Button asChild variant="outline" className="pg-button pg-secondary"><a href="./?mode=live">Start your Live workflow <ArrowRight size={17} /></a></Button></div></section>}
      {inspect && frame.done && <Suspense fallback={<p className="pg-run-footnote" role="status">Opening the complete record…</p>}><ChangeNetworkWorkspace embedded demoStage={3} initialTab="audit" demoScenario={scenario} /></Suspense>}
      <p className="pg-run-footnote">Guided simulation using local contract snapshots. Live reviews and transactions require a configured GenLayer v2 contract.</p>
    </main>
  </div>;
}
