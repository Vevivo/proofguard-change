// Checks the running service through actual MCP and HTTP, without a chain write.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readRuntimeConfig, readRuntimeToken } from './runtime-config.mjs';

const config = await readRuntimeConfig(), token = await readRuntimeToken();
const client = new Client({ name: 'proofguard-server-validation', version: '1.0.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./runtime-launch.mjs', import.meta.url)), 'mcp'], stderr: 'inherit' }));
  const tools = (await client.listTools()).tools.map(t => t.name);
  assert.equal(tools.length, 10); assert(tools.includes('proofguard_deliver_report'));
  for (const name of ['proofguard_get_report_status', 'proofguard_recheck_report', 'proofguard_get_report_events']) assert(tools.includes(name));
  assert(!tools.includes('proofguard_authorize_job')); assert(!tools.includes('proofguard_execute_approved_job'));
  const call = (name, args = {}) => client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
  const s = await call('proofguard_get_source'); assert(!s.isError, JSON.stringify(s));
  const revision = s.structuredContent.source.revision, workflowId = config.workflowIds[0];
  const w = await call('proofguard_inspect_workflow', { workflowId, expectedRevision: revision }); assert(!w.isError, JSON.stringify(w));
  const jobs = w.structuredContent.workflow.jobs;
  const current = jobs.find(j => j.state === 'OUTPUT_CREATED' && j.output?.isCurrentRevision);
  assert(current, 'A current output is required to validate delivery.');
  const checked = await call('proofguard_get_output', { workflowId, jobId: current.id, expectedRevision: revision }); assert(!checked.isError);
  const args = { workflowId, jobId: current.id, expectedRevision: revision, expectedOutputSha256: checked.structuredContent.sha256 };
  const first = await call('proofguard_deliver_report', args); assert(!first.isError, JSON.stringify(first));
  const repeat = await call('proofguard_deliver_report', args); assert(!repeat.isError && repeat.structuredContent.reused);
  const id = first.structuredContent.deliveryId;
  const status = await call('proofguard_get_report_status', { deliveryId: id });
  assert(!status.isError && status.structuredContent.state === 'CURRENT', JSON.stringify(status));
  assert(Date.parse(status.structuredContent.validUntil) > Date.now());
  const rechecked = await call('proofguard_recheck_report', { deliveryId: id });
  assert(!rechecked.isError && rechecked.structuredContent.state === 'CURRENT', JSON.stringify(rechecked));
  const history = await call('proofguard_get_report_events', { deliveryId: id, after: 0, limit: 100 });
  assert(!history.isError && history.structuredContent.events.length > 0, JSON.stringify(history));
  const page = await call('proofguard_get_report_events', { deliveryId: id, after: history.structuredContent.nextCursor, limit: 100 });
  assert(!page.isError && page.structuredContent.events.every(e => e.sequence > history.structuredContent.nextCursor));
  const content = await fetch(`http://127.0.0.1:8788/v1/reports/${id}/content`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  assert.equal(content.status, 200);
  const digest = createHash('sha256').update(await content.text()).digest('hex'); assert.equal(digest, args.expectedOutputSha256);
  const unauth = await fetch('http://127.0.0.1:8788/v1/reports', { method: 'POST', body: JSON.stringify(args), signal: AbortSignal.timeout(5000) }); assert.equal(unauth.status, 401);
  const held = jobs.find(j => ['CONDITION_CHANGED', 'EVIDENCE_NEEDED', 'REVIEW_REQUIRED'].includes(j.state));
  let heldJobRejected = null;
  if (held) { const rejected = await call('proofguard_deliver_report', { ...args, jobId: held.id }); assert(rejected.isError); heldJobRejected = rejected.structuredContent.error; }
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'DEPLOYED_SERVER_MCP_HTTP', network: config.network, contract: config.contract,
    sourceId: config.sourceId, workflowId, jobId: current.id, revision, deliveryId: id, outputSha256: digest,
    exactBytesVerified: true, repeatDeduplicated: true, alreadyStored: first.structuredContent.reused, unauthenticatedRejected: true, heldJobRejected,
    monitorStatus: status.structuredContent, explicitRecheckState: rechecked.structuredContent.state,
    monitorHistoryRead: true, monitorCursorRead: true,
    tools, transactionsSubmitted: 0, limitation: 'Operator-controlled server using an existing finalized artifact. Not an independent developer pilot or signed MCP lifecycle.' }, null, 2));
} finally { await client.close(); }
