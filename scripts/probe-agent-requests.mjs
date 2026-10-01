#!/usr/bin/env node
// Actual stdio MCP handoff against the public Studionet acceptance record.
// Reads and prepares an unsigned request only; no key or transaction is used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

const contract = '0x91883d4829E5b5bD7BED6eBd0EceF927A71942d6', sourceId = 'MOBILE-QA-20261001-1057';
const client = new Client({ name: 'proofguard-request-probe', version: '1.0.0' });
const childEnv = getDefaultEnvironment();
for (const key of ['NODE_USE_ENV_PROXY','NODE_EXTRA_CA_CERTS','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY','https_proxy','http_proxy','all_proxy','no_proxy']) if (process.env[key]) childEnv[key] = process.env[key];
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../agents/mcp-server.mjs', import.meta.url)), '--network', 'studionet', '--contract', contract, '--source', sourceId], env: childEnv, stderr: 'inherit' });
try {
  await client.connect(transport);
  const call = async (name, args = {}) => client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
  const result = await call('proofguard_get_source'); assert(!result.isError, JSON.stringify(result));
  const source = result.structuredContent;
  const prepared = await call('proofguard_prepare_workflow', { expectedRevision: source.source.revision,
    workflow: { id: 'AGENT-HANDOFF-20261001', title: 'Support plan approval request', owner: source.source.publisher, executor: source.source.publisher,
      jobs: [{ id: 'weekday-report', label: 'Weekday support price report', condition: 'The Standard support plan costs USD 49 per team per month and support is available Monday to Friday during business hours.',
        tool: 'prepare_price_report', target: 'standard-support-plan-team-month', payload: { unit_price: 49, currency: 'USD' } }] } });
  assert(!prepared.isError, JSON.stringify(prepared));
  const data = prepared.structuredContent, envelope = JSON.parse(data.requestJson);
  const status = await call('proofguard_get_request_status', { envelope }); assert(!status.isError, JSON.stringify(status));
  assert.equal(status.structuredContent.state, 'AWAITING_OWNER_REGISTRATION');
  const existing = source.bundle.workflows.find(w => w.id === 'MOBILE-QA-WF-20261001');
  assert(existing && existing.baseline_revision === source.source.revision);
  const registeredRequest = await call('proofguard_prepare_workflow', { expectedRevision: source.source.revision,
    workflow: { id: existing.id, title: existing.title, owner: existing.owner, executor: existing.executor,
      jobs: existing.actions.map(a => ({ id: a.id, label: a.label, condition: a.condition, ...JSON.parse(a.intent_json) })) } });
  assert(!registeredRequest.isError, JSON.stringify(registeredRequest));
  const registeredStatus = await call('proofguard_get_request_status', { envelope: JSON.parse(registeredRequest.structuredContent.requestJson) });
  assert(!registeredStatus.isError, JSON.stringify(registeredStatus));
  assert.equal(registeredStatus.structuredContent.state, 'REGISTERED');
  assert.equal(registeredStatus.structuredContent.jobs.find(j => j.id === 'weekday-price').state, 'OUTPUT_CREATED');
  assert.notEqual(registeredStatus.structuredContent.jobs.find(j => j.id === 'weekend-price').state, 'READY_FOR_CONTRACT_EXECUTION');
  const directory = process.env.PROOFGUARD_OUTPUT_DIR || 'outputs';
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'agent-handoff.proofguard.json'), JSON.stringify(envelope, null, 2));
  const report = { observedAt: new Date().toISOString(), mode: 'LIVE_MCP_STDIO_REQUEST_PREPARATION', contract, sourceId, sourceRevision: source.source.revision,
    requestSha256: envelope.sha256, state: status.structuredContent.state, transactionsSubmitted: 0,
    existingWorkflow: { id: existing.id, state: registeredStatus.structuredContent.state,
      jobs: registeredStatus.structuredContent.jobs.map(j => ({ id: j.id, state: j.state })) },
    limitation: 'Actual MCP transport and finalized RPC reads; this unsigned request has not been registered. Optional executor writes are separately covered with controlled tests, not this live probe.' };
  await fs.writeFile(path.join(directory, 'agent-handoff-probe.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await client.close(); }
