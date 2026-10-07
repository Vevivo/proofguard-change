#!/usr/bin/env node
// Real MCP stdio client against the saved Studio Next instance. Read-only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

const reference = JSON.parse(await fs.readFile(new URL('../deployments/studio-next-correction.json', import.meta.url), 'utf8'));
const client = new Client({ name: 'proofguard-live-probe', version: '0.1.0' });
// Inherit only ordinary process environment plus optional network configuration.
// Executor keys and unrelated credentials are not needed by this read-only child.
const childEnv = getDefaultEnvironment();
for (const key of ['NODE_USE_ENV_PROXY', 'NODE_EXTRA_CA_CERTS', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy']) {
  if (process.env[key]) childEnv[key] = process.env[key];
}
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../agents/mcp-server.mjs', import.meta.url)), '--network', 'studio-next', '--contract', reference.contract, '--source', 'CORRECTION-REGRESSION-01'], env: childEnv, stderr: 'inherit' });
const started = Date.now();
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 6);
  const call = (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: 55_000 });
  const inspected = await call('proofguard_inspect_workflow', { workflowId: 'DELIVERY-REGRESSION-01', expectedRevision: 2 });
  assert(!inspected.isError, JSON.stringify(inspected));
  assert.deepEqual(inspected.structuredContent.workflow.jobs.map(j => j.state), ['OUTPUT_CREATED', 'CONDITION_CHANGED']);
  const output = await call('proofguard_get_output', { workflowId: 'DELIVERY-REGRESSION-01', jobId: 'STANDARD', expectedRevision: 2 });
  assert(!output.isError, JSON.stringify(output));
  assert.equal(output.structuredContent.sha256, '9796fd13049b0b392b07813275dcb55d8b62354a62a27407658b68332aafc5e7');
  const held = await call('proofguard_get_output', { workflowId: 'DELIVERY-REGRESSION-01', jobId: 'EXPRESS' });
  assert.equal(held.isError, true); assert.equal(held.structuredContent.error, 'OUTPUT_NOT_CREATED');
  const stale = await call('proofguard_inspect_workflow', { workflowId: 'DELIVERY-REGRESSION-01', expectedRevision: 1 });
  assert.equal(stale.isError, true); assert.equal(stale.structuredContent.error, 'STALE_SOURCE_REVISION');
  console.log(JSON.stringify({ schema: 'proofguard-agent-connector-probe/1', observedAt: new Date().toISOString(), mode: 'LIVE_MCP_STDIO_RPC_READ', contract: reference.contract, chainId: 61997, toolCount: tools.length, checks: ['current jobs read', 'output digest and bindings checked', 'held job has no output', 'stale revision rejected'], outputSha256: output.structuredContent.sha256, elapsedMs: Date.now() - started, transactionsSubmitted: 0, limitation: 'One controlled fixture read through a standard MCP client. Not independent adoption, an autonomous LLM agent trial, an external-action guard or a light-client proof.' }, null, 2));
} finally { await client.close(); }
