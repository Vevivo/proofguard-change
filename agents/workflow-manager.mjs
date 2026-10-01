import { z } from 'zod';
import { getAddress } from 'viem';
import { sha256 } from './inspector.mjs';
import { canonical, requestId, requestAddress, requestEnvelope, parseAgentRequest, assessAgentRequest, requestRegistration } from '../genlayer/agent-request.mjs';
import { trackSubmittedTransaction, TransactionExecutionFailed } from '../genlayer/change-transaction.mjs';

const bytes = (min, max) => z.string().refine(v => Buffer.byteLength(v, 'utf8') >= min && Buffer.byteLength(v, 'utf8') <= max);
const revision = z.number().int().min(1).max(16);
export const managerInputs = {
  publish_source: { title: bytes(2, 160), text: bytes(20, 8192) },
  revise_source: { expectedRevision: revision, text: bytes(20, 8192) },
  approve_owner: { expectedRevision: revision, owner: requestAddress },
  register_workflow: { envelope: requestEnvelope },
  review_source: { expectedRevision: revision, workflowIds: z.array(requestId).min(1).max(4).refine(ids => new Set(ids).size === ids.length) },
  authorize_job: { expectedRevision: revision, workflowId: requestId, jobId: requestId, expectedIntentHash: z.string().regex(/^[a-f0-9]{64}$/) },
};
const equal = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const requireThat = (value, code) => { if (!value) throw Error(code); };

/** An explicitly delegated local account. Capabilities are set by the operator,
 * never by tool arguments. Enabling authorize_job delegates owner authority;
 * separate this server/account from the executor when human approval is wanted.
 */
export function createWorkflowManager({ inspector, client, account, workspace, capabilities, journal,
  finalize = hash => trackSubmittedTransaction({ hash, read: h => client.getTransaction({ hash: h }), onProgress: () => {}, maxDurationMs: 45000 }) }) {
  requireThat(workspace.chainId === 61999, 'MANAGEMENT_REQUIRES_STUDIONET');
  requireThat(Array.isArray(capabilities) && capabilities.length > 0 && new Set(capabilities).size === capabilities.length && capabilities.every(c => Object.hasOwn(managerInputs, c)), 'INVALID_MANAGER_CAPABILITIES');
  const allowed = new Set(capabilities), active = new Set();
  const source = async () => {
    const s = await inspector.inspectSource();
    requireThat(s.chainId === workspace.chainId && equal(s.contract, workspace.contract) && s.source.id === workspace.sourceId, 'WORKSPACE_MISMATCH');
    return s;
  };
  const current = (s, revision) => requireThat(s.source.revision === revision, 'STALE_SOURCE_REVISION');
  const publisher = s => requireThat(equal(s.source.publisher, account), 'ONLY_SOURCE_PUBLISHER');

  async function plan(operation, input) {
    if (operation === 'publish_source') {
      const c = await inspector.inspectContract();
      requireThat(c.chainId === workspace.chainId && equal(c.contract, workspace.contract) && c.sourceId === workspace.sourceId, 'WORKSPACE_MISMATCH');
      if (c.sourceIds.includes(workspace.sourceId)) {
        const s = await source(); publisher(s);
        requireThat(s.source.revision === 1 && s.source.title === input.title && s.source.sha256 === sha256(input.text), 'SOURCE_ALREADY_EXISTS');
        return { existing: true };
      }
      return { method: 'publish_source', args: [workspace.sourceId, input.title, input.text] };
    }
    const s = await source();
    if (operation === 'register_workflow') {
      const envelope = await parseAgentRequest(JSON.stringify(input.envelope), sha256);
      requireThat(equal(envelope.request.workflow.owner, account), 'ONLY_WORKFLOW_OWNER');
      if (assessAgentRequest(envelope, s) === 'REGISTERED') return { existing: true };
      return { method: 'register_workflow', args: requestRegistration(envelope) };
    }
    if (operation === 'revise_source') {
      publisher(s);
      if (s.source.revision === input.expectedRevision + 1 && s.source.sha256 === sha256(input.text)) return { existing: true };
      current(s, input.expectedRevision);
      requireThat(s.source.revision < 16, 'SOURCE_REVISION_LIMIT');
      requireThat(s.source.sha256 !== sha256(input.text), 'SOURCE_UNCHANGED');
      return { method: 'revise_source', args: [workspace.sourceId, BigInt(input.expectedRevision), input.text] };
    }
    current(s, input.expectedRevision);
    if (operation === 'approve_owner') {
      publisher(s);
      if (s.bundle.source.approved_owners.includes(input.owner)) return { existing: true };
      requireThat(s.bundle.source.approved_owners.length < 8, 'SOURCE_OWNER_LIMIT');
      return { method: 'approve_workflow_owner', args: [workspace.sourceId, input.owner] };
    }
    if (operation === 'review_source') {
      const chosen = input.workflowIds.map(id => s.bundle.workflows.find(w => w.id === id));
      requireThat(chosen.every(Boolean), 'WORKFLOW_NOT_FOUND');
      if (chosen.every(w => w.reviewed_revision === input.expectedRevision)) return { existing: true };
      const pending = s.bundle.workflows.filter(w => w.reviewed_revision !== input.expectedRevision).map(w => w.id).sort();
      requireThat(canonical(pending) === canonical([...input.workflowIds].sort()), 'REVIEW_SET_CHANGED');
      return { method: 'review_source', args: [workspace.sourceId, BigInt(input.expectedRevision)] };
    }
    const detail = await inspector.inspectWorkflow({ workflowId: input.workflowId, expectedRevision: input.expectedRevision });
    requireThat(equal(detail.workflow.owner, account), 'ONLY_WORKFLOW_OWNER');
    const job = detail.workflow.jobs.find(j => j.id === input.jobId);
    requireThat(job?.intentHash === input.expectedIntentHash, 'INTENT_MISMATCH');
    if (job.state === 'OUTPUT_CREATED') requireThat(job.output?.isCurrentRevision, 'HISTORICAL_OUTPUT_REQUIRES_NEW_WORKFLOW');
    if (job.state === 'READY_FOR_CONTRACT_EXECUTION' || job.state === 'OUTPUT_CREATED') return { existing: true };
    requireThat(job.state === 'AUTHORIZATION_REQUIRED', 'JOB_NOT_SUPPORTED');
    return { method: 'authorize_action', args: [input.workflowId, input.jobId, BigInt(input.expectedRevision), input.expectedIntentHash] };
  }

  async function observed(operation, input) {
    const s = await source();
    if (operation === 'publish_source') {
      publisher(s); requireThat(s.source.title === input.title && s.bundle.source.versions[0].sha256 === sha256(input.text), 'PUBLISHED_SOURCE_MISMATCH');
    } else if (operation === 'revise_source') {
      publisher(s); requireThat(s.source.revision === input.expectedRevision + 1 && s.source.sha256 === sha256(input.text), 'REVISION_NOT_CONFIRMED');
    } else if (operation === 'approve_owner') {
      publisher(s); requireThat(s.bundle.source.approved_owners.includes(input.owner), 'OWNER_NOT_CONFIRMED');
    } else if (operation === 'register_workflow') {
      requireThat(assessAgentRequest(input.envelope, s) === 'REGISTERED', 'REGISTRATION_NOT_CONFIRMED');
    } else if (operation === 'review_source') {
      current(s, input.expectedRevision);
      requireThat(input.workflowIds.every(id => s.bundle.workflows.find(w => w.id === id)?.reviewed_revision === input.expectedRevision), 'REVIEW_NOT_CONFIRMED');
    } else {
      current(s, input.expectedRevision);
      const detail = await inspector.inspectWorkflow({ workflowId: input.workflowId, expectedRevision: input.expectedRevision });
      const job = detail.workflow.jobs.find(j => j.id === input.jobId);
      if (job?.state === 'OUTPUT_CREATED') requireThat(job.output?.isCurrentRevision, 'HISTORICAL_OUTPUT_REQUIRES_NEW_WORKFLOW');
      requireThat(equal(detail.workflow.owner, account) && job?.intentHash === input.expectedIntentHash && ['READY_FOR_CONTRACT_EXECUTION', 'OUTPUT_CREATED'].includes(job.state), 'AUTHORIZATION_NOT_CONFIRMED');
    }
    return { sourceRevision: s.source.revision, sourceSha256: s.source.sha256 };
  }

  return { capabilities: [...allowed], async run(operation, raw) {
    requireThat(allowed.has(operation), 'MANAGER_CAPABILITY_DISABLED');
    let input;
    try { input = z.object(managerInputs[operation]).strict().parse(raw); } catch { throw Error('INVALID_MANAGER_INPUT'); }
    // Canonical input and account bind recovery to this exact delegated operation.
    const operationId = sha256(canonical({ scope: 'proofguard-manager/1', workspace, account: account.toLowerCase(), operation, input }));
    requireThat(active.size === 0, 'OPERATION_IN_PROGRESS'); active.add(operationId);
    try {
      let saved = await journal.read(operationId);
      if (!saved) {
        const tx = await plan(operation, input);
        if (tx.existing) return { state: 'STATE_CONFIRMED', reused: true, operation, operationId, ...await observed(operation, input) };
        saved = { operationId, operation, state: 'SUBMITTING' };
        requireThat(await journal.claim(operationId, saved), 'OPERATION_IN_PROGRESS');
        try {
          const hash = String(await client.writeContract({ address: getAddress(workspace.contract.toLowerCase()), functionName: tx.method, args: tx.args, value: 0n }));
          requireThat(/^0x[a-f0-9]{64}$/i.test(hash), 'INVALID_TRANSACTION_HASH');
          saved = { ...saved, state: 'SUBMITTED', hash }; await journal.update(operationId, saved);
        } catch { throw Error('SUBMISSION_OUTCOME_UNKNOWN'); }
      }
      requireThat(/^0x[a-f0-9]{64}$/i.test(saved.hash || ''), 'SUBMISSION_OUTCOME_UNKNOWN');
      try { await finalize(saved.hash); }
      catch (error) {
        return { state: error instanceof TransactionExecutionFailed ? 'TRANSACTION_FAILED' : 'TRANSACTION_PENDING', operation, operationId, transactionHash: saved.hash,
          guidance: 'Repeat the same call to inspect the same transaction. No new transaction will be submitted. A finalized transaction alone does not establish the requested state.' };
      }
      return { state: 'STATE_CONFIRMED', operation, operationId, transactionHash: saved.hash, ...await observed(operation, input) };
    } finally { active.delete(operationId); }
  } };
}
