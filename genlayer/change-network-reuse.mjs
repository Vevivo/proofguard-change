// Reuse definitions only for an untouched v1 setup owned by this wallet.
// No revisions, permissions, reviews or outputs are transferred or fabricated.
export function reusableNetworkSetup(bundle, account) {
  if (!account || bundle?.source?.revision !== 1 || bundle?.workflows?.length !== 1 ||
      bundle.source.publisher !== account.toLowerCase()) return null;
  const workflow = bundle.workflows[0];
  if (workflow.owner !== account.toLowerCase() || workflow.baseline_revision !== 1 ||
      workflow.reviewed_revision !== 0 || workflow.reviews.length || workflow.attempts.length ||
      workflow.actions.some(a => a.execution || a.permits.length)) return null;
  const jobs = workflow.actions.map(a => {
    const intent = JSON.parse(a.intent_json);
    return { id: a.id, label: a.label, condition: a.condition, tool: intent.tool,
      target: intent.target, payload: { ...intent.payload } };
  });
  return { sourceId: bundle.source.id, sourceTitle: bundle.source.title,
    sourceText: bundle.source.versions[0].text, workflowId: workflow.id,
    workflowTitle: workflow.title, executor: workflow.executor, jobs };
}
