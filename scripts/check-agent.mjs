#!/usr/bin/env node
// Checks an actual stdio MCP connection. Never enables signing or delivery.
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { agentCheckCommand } from '../genlayer/agent-setup.mjs';

const options = {};
try {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--network', '--contract', '--source'].includes(key) || !args[i + 1] || options[key]) throw Error('INVALID_CONFIGURATION');
    options[key] = args[i + 1];
  }
  agentCheckCommand({ network: options['--network'], contract: options['--contract'], sourceId: options['--source'] });
} catch {
  console.error('Provide --network studionet|studio-next --contract 0x... --source SOURCE-ID. Copy the command from Evidence Desk → Connect an agent.');
  process.exit(1);
}
const environment = getDefaultEnvironment();
for (const name of ['NODE_USE_ENV_PROXY', 'NODE_EXTRA_CA_CERTS', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy']) {
  if (process.env[name]) environment[name] = process.env[name];
}
const client = new Client({ name: 'proofguard-connection-check', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../agents/mcp-server.mjs', import.meta.url)), ...process.argv.slice(2)], env: environment, stderr: 'inherit' });
let step = 'Start MCP server';
const deadline = setTimeout(() => { console.error(`Connection check timed out at: ${step}. No transaction was submitted.`); void client.close().finally(() => process.exit(1)); }, 60_000);
try {
  console.log('1/3 Starting the local MCP server…');
  await client.connect(transport);
  step = 'Discover tools';
  console.log('2/3 Checking available tools…');
  const { tools } = await client.listTools();
  const expected = ['proofguard_list_workflows', 'proofguard_inspect_workflow', 'proofguard_get_output', 'proofguard_get_source', 'proofguard_prepare_workflow', 'proofguard_get_request_status'];
  if (tools.length !== expected.length || !expected.every(name => tools.some(tool => tool.name === name && tool.annotations?.readOnlyHint))) throw Error('UNEXPECTED_TOOL_SET');
  step = 'Read finalized source';
  console.log('3/3 Reading and verifying the configured network record…');
  const response = await client.callTool({ name: 'proofguard_get_source', arguments: {} }, undefined, { timeout: 50_000 });
  if (response.isError) throw Error(response.structuredContent?.error || 'READ_FAILED');
  const record = response.structuredContent;
  if (!record || record.mode !== 'LIVE_FINALIZED_RPC_READ' || record.chainId !== (options['--network'] === 'studionet' ? 61999 : 61997) || record.contract.toLowerCase() !== options['--contract'].toLowerCase() || record.source.id !== options['--source']) throw Error('WORKSPACE_MISMATCH');
  console.log(JSON.stringify({ result: 'MCP connection verified', network: options['--network'], chainId: record.chainId, contract: record.contract, sourceId: record.source.id, revision: record.source.revision, observedAt: record.observedAt, tools: tools.map(tool => tool.name), transactionsSubmitted: 0 }, null, 2));
  console.log('Next: add the generated configuration to your agent client, then run the first task from the setup guide. This check verifies local stdio and RPC access, not a connection inside another client.');
} catch (error) {
  const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'CONNECTION_FAILED';
  console.error(`Check failed at: ${step} (${code}).`);
  console.error(step === 'Read finalized source' ? 'Check the network, contract and Source ID. If the test network is slow, retry later. No current result was established.' : 'Check Node.js, run npm ci from the project folder, and confirm agents/mcp-server.mjs exists.');
  process.exitCode = 1;
} finally { clearTimeout(deadline); await client.close(); }
