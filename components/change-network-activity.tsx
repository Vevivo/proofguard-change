"use client";

import { CheckCheck, CircleAlert, LoaderCircle, ArrowUpRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NETWORK_EXPLORER, type NetworkProgress } from "@/genlayer/change-network-client";
import { networkActivityState, networkActivityTitle } from "@/genlayer/change-network-activity.mjs";

export function NetworkActivity({ progress, pending, busy, error, notice, operation, dismissed, onDismiss, onRecover }: {
  progress: NetworkProgress | null; pending: NetworkProgress | null; busy: boolean;
  error: string; notice: string; operation: string; dismissed: boolean;
  onDismiss: () => void; onRecover: () => void;
}) {
  const state = networkActivityState({ progress, pending, busy, error });
  if (!state || (dismissed && !busy && !pending)) return null;
  const running = ["preparing", "pending", "refreshing"].includes(state);
  const detail = error ? (progress?.finalized ? `The transaction is confirmed, but the updated record could not be read. ${error}` : error) : state === "refreshing" ? "The transaction succeeded. Waiting for the latest verified source and job records." : state === "success" ? notice || "Successfully finalized on GenLayer." : progress?.label || operation;
  return <aside className={`nw-activity ${state}`} aria-label="Transaction activity">
    <div className="nw-activity-glow" aria-hidden="true" />
    <div className="nw-activity-body">
      <span className="nw-activity-icon" aria-hidden="true">{running ? <LoaderCircle className="nw-spin" size={22} /> : state === "success" ? <CheckCheck size={23} /> : <CircleAlert size={23} />}</span>
      <div className="nw-activity-copy" role="status" aria-live="polite" aria-atomic="true">
        <strong>{error && progress?.finalized ? "Confirmed · refresh needed" : networkActivityTitle(state, progress?.method)}</strong>
        <p>{detail}</p>
        {progress?.fee && <small>Estimated fee: {progress.fee} GEN</small>}
      </div>
      <div className="nw-activity-actions">
        {progress?.hash && <a href={`${NETWORK_EXPLORER}/tx/${progress.hash}`} target="_blank" rel="noreferrer">Transaction <ArrowUpRight size={14} /></a>}
        {pending && !busy && <Button className="nw-button" variant="outline" onClick={onRecover}>Check transaction</Button>}
        {!busy && !pending && <button type="button" className="nw-activity-dismiss" aria-label="Dismiss transaction update" onClick={onDismiss}><X size={18} /></button>}
      </div>
    </div>
    <div className="nw-activity-track" aria-hidden="true"><span /></div>
  </aside>;
}
