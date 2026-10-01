import { z } from 'zod';

export const REQUEST_SCHEMA = 'proofguard-agent-request/1.0';
export const MAX_REQUEST_BYTES = 16000;
const bytes = text => new TextEncoder().encode(text).length;
const text = (min, max) => z.string().refine(s => bytes(s) >= min && bytes(s) <= max, 'Invalid UTF-8 length');
export const requestId = z.string().regex(/^[A-Za-z0-9_.-]{2,80}$/);
export const requestAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(s => !/^0x0{40}$/i.test(s)).transform(s => s.toLowerCase());
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const price = { unit_price: z.number().int().min(1).max(100000000), currency: z.string().regex(/^[A-Z]{3}$/) };
const job = { id: requestId, label: text(2, 160), condition: text(10, 1200), target: text(2, 120) };
export const requestJob = z.discriminatedUnion('tool', [
  z.object({ ...job, tool: z.literal('prepare_price_report'), payload: z.object(price).strict() }).strict(),
  z.object({ ...job, tool: z.literal('prepare_purchase_order'), payload: z.object({ ...price, quantity: z.number().int().min(1).max(10000), shipping: z.enum(['standard', 'express']) }).strict() }).strict(),
]);
export const requestWorkflow = z.object({
  id: requestId, title: text(2, 160), owner: requestAddress, executor: requestAddress,
  jobs: z.array(requestJob).min(1).max(3).refine(jobs => new Set(jobs.map(j => j.id)).size === jobs.length, 'Duplicate job ID'),
}).strict();
export const prepareRequestInput = {
  expectedRevision: z.number().int().min(1).max(16), workflow: requestWorkflow,
};
export const requestBody = z.object({
  schema: z.literal(REQUEST_SCHEMA), chainId: z.literal(61999), contract: requestAddress,
  contractCodeSha256: digest, sourceId: requestId, sourceRevision: z.number().int().min(1).max(16),
  sourceSha256: digest, workflow: requestWorkflow,
}).strict();
export const requestEnvelope = z.object({ request: requestBody, sha256: digest }).strict();

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
/** @returns {never} */
function invalid(code) { throw new Error(code); }
export async function parseAgentRequest(raw, sha256) {
  if (typeof raw !== 'string' || bytes(raw) > MAX_REQUEST_BYTES) invalid('INVALID_AGENT_REQUEST');
  let envelope;
  try { envelope = requestEnvelope.parse(JSON.parse(raw)); } catch { invalid('INVALID_AGENT_REQUEST'); }
  if (await sha256(canonical(envelope.request)) !== envelope.sha256) invalid('REQUEST_DIGEST_MISMATCH');
  return envelope;
}

/** The checksum detects changed bytes; it does not authenticate the sender. */
export function assessAgentRequest(envelope, snapshot) {
  const r = envelope.request, w = r.workflow;
  if (r.chainId !== snapshot.chainId || r.contract !== snapshot.contract.toLowerCase() || r.contractCodeSha256 !== snapshot.contractCodeSha256 || r.sourceId !== snapshot.source.id) invalid('REQUEST_WORKSPACE_MISMATCH');
  if (r.sourceRevision !== snapshot.source.revision || r.sourceSha256 !== snapshot.source.sha256) invalid('STALE_SOURCE_REVISION');
  const existing = snapshot.bundle.workflows.find(item => item.id === w.id);
  if (existing) {
    const actual = { id: existing.id, title: existing.title, owner: existing.owner, executor: existing.executor,
      jobs: existing.actions.map(a => ({ id: a.id, label: a.label, condition: a.condition, ...JSON.parse(a.intent_json) })) };
    if (existing.baseline_revision !== r.sourceRevision || canonical(actual) !== canonical(w)) invalid('WORKFLOW_REQUEST_CONFLICT');
    return 'REGISTERED';
  }
  if (!snapshot.bundle.source.approved_owners.includes(w.owner)) invalid('SOURCE_OWNER_APPROVAL_REQUIRED');
  if (snapshot.bundle.workflows.length >= 4) invalid('SOURCE_WORKFLOW_LIMIT');
  return 'AWAITING_OWNER_REGISTRATION';
}

export async function prepareAgentRequest(inspector, input, sha256) {
  let clean;
  try { clean = z.object(prepareRequestInput).strict().parse(input); } catch { invalid('INVALID_AGENT_REQUEST'); }
  const snapshot = await inspector.inspectSource();
  if (snapshot.chainId !== 61999) invalid('REQUESTS_REQUIRE_STUDIONET');
  if (snapshot.source.revision !== clean.expectedRevision) invalid('STALE_SOURCE_REVISION');
  const request = requestBody.parse({ schema: REQUEST_SCHEMA, chainId: snapshot.chainId, contract: snapshot.contract,
    contractCodeSha256: snapshot.contractCodeSha256, sourceId: snapshot.source.id, sourceRevision: snapshot.source.revision,
    sourceSha256: snapshot.source.sha256, workflow: clean.workflow });
  const envelope = { request, sha256: await sha256(canonical(request)) };
  assessAgentRequest(envelope, snapshot);
  return envelope;
}

export async function agentRequestStatus(inspector, envelope, sha256) {
  const checked = await parseAgentRequest(JSON.stringify(envelope), sha256);
  const snapshot = await inspector.inspectSource();
  const state = assessAgentRequest(checked, snapshot);
  const result = { requestSha256: checked.sha256, state, observedAt: snapshot.observedAt,
    sourceRevision: snapshot.source.revision, workflowId: checked.request.workflow.id };
  if (state === 'REGISTERED') {
    const detail = await inspector.inspectWorkflow({ workflowId: result.workflowId, expectedRevision: checked.request.sourceRevision });
    return { ...result, jobs: detail.workflow.jobs };
  }
  return result;
}

export function requestRegistration(envelope) {
  const r = envelope.request, w = r.workflow;
  return [w.id, w.title, r.sourceId, BigInt(r.sourceRevision), w.executor, JSON.stringify(w.jobs)];
}
