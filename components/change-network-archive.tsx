"use client";

import { ArrowUpRight, CheckCheck, FileCheck2, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { ArchiveDraft, ArchivePublication } from "@/genlayer/change-publication";

export function NetworkArchive({ draft, publication, consent, busy, disabled, error, activity, onConsent, onPrepare, onPublish, onVerify }: {
  draft: ArchiveDraft | null; publication: ArchivePublication | null; consent: boolean;
  busy: boolean; disabled: boolean; error: string; activity: string;
  onConsent: (value: boolean) => void; onPrepare: () => void; onPublish: () => void; onVerify: () => void;
}) {
  const retrieval = publication ? ({ VERIFIED:"Verified · exact bytes match", NOT_CHECKED:"Not checked yet", UNAVAILABLE:"Not available from the gateway", MISMATCH:"Returned bytes do not match" })[publication.retrieval] : "";
  return <Dialog>
    <div className="nw-archive-control">
      <DialogTrigger asChild><Button className="nw-button" variant="outline"><FileCheck2 size={15} />{publication ? "View archive" : "Archive on Arweave"}</Button></DialogTrigger>
      <a className="nw-ario-credit" href="https://ar.io" target="_blank" rel="noreferrer">Powered by <strong>AR.IO</strong><span>· Turbo</span><ArrowUpRight size={12} /></a>
    </div>
    <DialogContent className="nw-app nw-archive-dialog">
      <DialogHeader>
        <div className="nw-panel-label"><FileCheck2 size={16} />ARWEAVE ARCHIVE</div>
        <DialogTitle>{publication ? "Your signed snapshot" : "Archive this record"}</DialogTitle>
        <DialogDescription>Save a signed copy of the complete audit record through Turbo. Check that the gateway returns the same bytes.</DialogDescription>
      </DialogHeader>
      {busy && <div className="nw-archive-working" role="status"><LoaderCircle className="nw-spin" size={18} /><span>{activity || "Working on your request…"}</span></div>}
      {error && <div className="nw-message error" role="alert">{error}</div>}
      {!publication && <div className="nw-archive-setup">
        {!draft && <p className="nw-muted">Check the upload price first. You can review it before signing.</p>}
        <Button className="nw-button" variant="outline" disabled={disabled} onClick={onPrepare}>{draft ? "Refresh upload quote" : "Prepare archive & quote"}</Button>
        {draft && <div className="nw-archive-quote">
          <dl className="nw-archive-facts"><div><dt>Source</dt><dd>v{draft.revision} · {draft.bytes.toLocaleString("en-US")} bytes</dd></div><div><dt>Upload quote</dt><dd>{BigInt(draft.quotedWinc).toLocaleString("en-US")} winc</dd></div></dl>
          <label className="nw-checkbox"><input type="checkbox" checked={consent} disabled={busy} onChange={e => onConsent(e.target.checked)} />I understand this snapshot will be public and may remain permanently accessible.</label>
          <Button className="nw-button primary" disabled={disabled || !consent} onClick={onPublish}>Sign & publish snapshot</Button>
        </div>}
        <p className="nw-fine">Uses your existing Turbo credits. Your wallet signs the snapshot; no automatic top-up or token transfer.</p>
      </div>}
      {publication && <div className={`nw-archive-result ${publication.retrieval === "VERIFIED" ? "verified" : ""}`}>
        <div className="nw-archive-result-heading"><FileCheck2 size={21} /><strong>Snapshot v{publication.revision}</strong>{publication.retrieval === "VERIFIED" && <span className="nw-status ready"><CheckCheck size={14} />Access verified</span>}</div>
        <dl className="nw-archive-facts"><div><dt>Upload</dt><dd>{publication.uploadStatus === "ACCEPTED" ? "Accepted by Turbo" : "Submitted · acceptance not confirmed"}</dd></div><div><dt>Retrieval</dt><dd>{retrieval}</dd></div></dl>
        <div className="nw-actions"><Button className="nw-button primary" asChild><a href={`https://turbo-gateway.com/${publication.recordId}`} target="_blank" rel="noreferrer">Open signed snapshot <ArrowUpRight size={15} /></a></Button><Button className="nw-button" variant="outline" disabled={busy} onClick={onVerify}>Check retrieval again</Button></div>
        <details className="nw-details"><summary>Archive verification details</summary><p>Arweave settlement: not independently verified. Retrieval verification compares the gateway response with the signed snapshot’s bytes and SHA-256 digest.</p><code className="nw-hash">Record ID {publication.recordId}</code><code className="nw-hash">SHA-256 {publication.sha256}</code></details>
      </div>}
      <a className="nw-ario-credit nw-ario-footer" href="https://ar.io" target="_blank" rel="noreferrer">Powered by <strong>AR.IO</strong><span>· Turbo uploads to Arweave</span><ArrowUpRight size={12} /></a>
    </DialogContent>
  </Dialog>;
}
