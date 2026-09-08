// UI feedback follows observed transaction state; it never grants permission.
export function networkActivityState({ progress, busy, error, pending }) {
  if (error) return progress?.finalized || pending ? "attention" : "failed";
  if (progress?.failed) return "failed";
  if (progress?.recoverable && !busy) return "attention";
  if (progress?.finalized) return busy ? "refreshing" : "success";
  if (pending && !busy) return "attention";
  if (progress?.hash) return "pending";
  return busy ? "preparing" : null;
}

export function networkActivityTitle(state, method) {
  if (state === "success") return ({
    deploy: "Contract ready",
    publish_source: "Source published",
    revise_source: "Source correction published",
    register_workflow: "Protected jobs registered",
    review_source: "Review complete",
    authorize_action: "Permission recorded",
    execute_action: "Output created",
    approve_workflow_owner: "Owner approved",
  })[method] || "Transaction complete";
  return ({
    preparing: "Preparing your request",
    pending: "Transaction in progress",
    refreshing: "Confirmed · reading the updated record",
    attention: "Check the transaction",
    failed: "Request not completed",
  })[state] || "";
}
