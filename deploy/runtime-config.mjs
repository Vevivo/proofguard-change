import fs from 'node:fs/promises';
import { z } from 'zod';
import { requestId } from '../genlayer/agent-request.mjs';

export const runtimeDirectory = '/run/proofguard';
export const runtimeConfigSchema = z.object({
  network: z.enum(['studionet', 'studio-next']),
  contract: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  sourceId: requestId,
  workflowIds: z.array(requestId).min(1).max(4).refine(ids => new Set(ids).size === ids.length),
}).strict();
export const workspaceArgs = c => ['--network', c.network, '--contract', c.contract, '--source', c.sourceId];
export async function readRuntimeConfig() {
  return runtimeConfigSchema.parse(JSON.parse(await fs.readFile(`${runtimeDirectory}/workspace.json`, 'utf8')));
}
export async function readRuntimeToken() {
  const token = (await fs.readFile(`${runtimeDirectory}/service.token`, 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw Error('INVALID_SERVICE_TOKEN');
  return token;
}
