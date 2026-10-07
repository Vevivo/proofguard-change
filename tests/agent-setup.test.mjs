import test from 'node:test';
import assert from 'node:assert/strict';
import { agentConfiguration, agentCheckCommand } from '../genlayer/agent-setup.mjs';
const connection = { network: 'studionet', contract: '0x' + 'a'.repeat(40), sourceId: 'SOURCE-01' };
test('configuration handles Windows paths and spaces without adding write capabilities', () => {
  const server = agentConfiguration('C:\\My Projects\\proofguard-change\\', connection).mcpServers.proofguard;
  assert.equal(server.args[0], 'C:/My Projects/proofguard-change/agents/mcp-server.mjs');
  assert.deepEqual(server.args.slice(1), ['--network','studionet','--contract',connection.contract,'--source','SOURCE-01']);
  assert.equal(server.env, undefined);
  assert.equal(agentConfiguration('/Users/me/My Projects/proofguard-change',connection).mcpServers.proofguard.args[0], '/Users/me/My Projects/proofguard-change/agents/mcp-server.mjs');
});
test('setup rejects placeholder, relative and control-character paths', () => {
  for (const path of ['', 'proofguard-change', '/absolute/path/proofguard-change', '/project\nother']) assert.equal(agentConfiguration(path,connection),null);
});
test('copied shell check cannot include unvalidated source or endpoint arguments', () => {
  assert(agentCheckCommand(connection).includes('--source SOURCE-01'));
  assert.throws(() => agentCheckCommand({...connection,sourceId:'SOURCE; echo unsafe'}),/INVALID_CONFIGURATION/);
  assert.throws(() => agentCheckCommand({...connection,network:'http://other'}),/INVALID_CONFIGURATION/);
});
