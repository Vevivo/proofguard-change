export function confirmedBlock(record, action) {
  if (!record || record.reviewed_revision !== record.revision) return undefined;
  const review = record.reviews.find(item => item.revision === record.revision);
  const decision = review?.actions.find(item => item.id === action.id);
  if (!decision || decision.verdict === "NO_MATERIAL_CHANGE") return undefined;
  return record.attempts.find(attempt => attempt.action_id === action.id &&
    attempt.requested_revision === record.revision && attempt.current_revision === record.revision &&
    attempt.intent_hash === action.intent_hash && attempt.allowed === false && attempt.code === decision.verdict);
}
