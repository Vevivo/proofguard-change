/** Derive the next step from the inspected record, never from UI timers. */
export function jobOperation(workflow, job, revision) {
  const base = { workflowId: workflow.id, jobId: job.id, expectedRevision: revision };
  if (job.execution) {
    if (job.execution.revision !== revision) return { group: 'attention', label: 'Replace historical output', actor: 'Workflow owner', priority: 4,
      guidance: 'Keep this artifact for history. Prepare a new workflow against the current source to produce a new report.', tool: null, args: null };
    return { group: 'outputs', label: 'Use verified output', actor: 'Report consumer', priority: 5,
      guidance: 'Download the artifact, or deliver it to your configured report vault. The vault checks the current source again.',
      tool: 'proofguard_deliver_report', args: { ...base, expectedOutputSha256: job.execution.output_sha256 } };
  }
  if (job.gate === 'AWAITING_REVIEW') return { group: 'attention', label: 'Request current review', actor: 'Reviewer', priority: 0,
    guidance: 'Request a GenLayer review of the pending workflows before granting any job permission.', tool: null, args: null };
  if (job.gate === 'READY') {
    const permitted = !!job.active_permit;
    return { group: permitted ? 'ready' : 'attention', label: permitted ? 'Generate the artifact' : 'Owner approval required',
      actor: permitted ? 'Registered executor' : 'Workflow owner', priority: permitted ? 2 : 1,
      guidance: permitted ? 'A current permit is available. Execution rechecks the source and exact intent in the contract.' : 'The review supports this job. Its owner must grant a permit before execution.',
      tool: permitted ? 'proofguard_execute_approved_job' : 'proofguard_authorize_job', args: { ...base, expectedIntentHash: job.intent_hash } };
  }
  return { group: 'attention', label: job.gate === 'MATERIAL_CHANGE' ? 'Resolve changed conditions' : 'Supply missing evidence', actor: 'Source publisher', priority: 3,
    guidance: 'Keep this job held. Correct the source only with substantiated evidence, then request a fresh review.', tool: null, args: null };
}
