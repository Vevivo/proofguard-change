#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { sha256 } from '../agents/inspector.mjs';
import { canonical, requestId } from '../genlayer/agent-request.mjs';
import { createReportMonitor } from './report-monitor.mjs';

export const deliveryInput = {
  workflowId: requestId, jobId: requestId, expectedRevision: z.number().int().min(1).max(16),
  expectedOutputSha256: z.string().regex(/^[a-f0-9]{64}$/),
};
export const validServiceToken = token => typeof token === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(token);
const requireThat = (value, code) => { if (!value) throw Error(code); };

/** The service owns its storage and reads the chain itself. The caller supplies
 * identifiers, never report bytes, RPC URLs, paths or a claimed approval.
 * Admission is an RPC observation, not an atomic lock across two systems.
 */
export function createReportVault({ inspector, directory, token, allowedWorkflows, maxConcurrent = 4, monitorIntervalMs = 60_000, freshnessMs = 120_000, now = Date.now }) {
  requireThat(validServiceToken(token), 'VAULT_TOKEN_REQUIRED');
  requireThat(Array.isArray(allowedWorkflows) && allowedWorkflows.length > 0 && allowedWorkflows.every(w => requestId.safeParse(w).success), 'VAULT_WORKFLOW_ALLOWLIST_REQUIRED');
  requireThat(typeof directory === 'string' && directory.length > 0, 'VAULT_DIRECTORY_REQUIRED');
  const allowed = new Set(allowedWorkflows); let inFlight = 0;
  const authenticate = value => {
    const actual = Buffer.from(value || ''), expected = Buffer.from(`Bearer ${token}`);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  async function verify(input) {
    requireThat(allowed.has(input.workflowId), 'WORKFLOW_NOT_ALLOWED');
    const vaultCheckStartedAt = now();
    const output = await inspector.getOutput({ workflowId: input.workflowId, jobId: input.jobId, expectedRevision: input.expectedRevision });
    requireThat(output.isCurrentRevision && output.outputRevision === input.expectedRevision, 'HISTORICAL_OUTPUT_BLOCKED');
    requireThat(output.sha256 === input.expectedOutputSha256 && sha256(output.outputJson) === output.sha256, 'OUTPUT_DIGEST_MISMATCH');
    requireThat(['prepare_price_report', 'prepare_purchase_order'].includes(output.output.tool), 'UNSUPPORTED_OUTPUT');
    return { ...output, vaultCheckStartedAt };
  }
  async function loadRecord(id) {
    let record;
    try { record = JSON.parse(await fs.readFile(path.join(directory, `${id}.json`), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') throw Error('REPORT_NOT_FOUND');
      throw Error(error instanceof SyntaxError ? 'STORED_RECORD_MISMATCH' : 'REPORT_STORAGE_UNAVAILABLE');
    }
    try {
      const input = z.object(deliveryInput).strict().parse(record.input);
      requireThat(allowed.has(input.workflowId), 'WORKFLOW_NOT_ALLOWED');
      requireThat(record.schema === 'proofguard-delivery/1.0' && record.id === id && typeof record.contract === 'string'
        && record.outputSha256 === input.expectedOutputSha256 && sha256(record.outputJson) === record.outputSha256
        && id === sha256(canonical({ chainId: record.chainId, contract: record.contract.toLowerCase(), sourceId: record.sourceId,
          workflowId: input.workflowId, jobId: input.jobId, outputSha256: record.outputSha256 })), 'STORED_RECORD_MISMATCH');
    } catch (error) { throw Error(error.message === 'WORKFLOW_NOT_ALLOWED' ? error.message : 'STORED_RECORD_MISMATCH'); }
    return record;
  }
  async function verifyRecord(record) {
    const output = await verify(record.input);
    requireThat(record.chainId === output.chainId && record.contract.toLowerCase() === output.contract.toLowerCase()
      && record.sourceId === output.source.id && record.outputSha256 === output.sha256 && record.outputJson === output.outputJson, 'STORED_RECORD_MISMATCH');
    return output;
  }
  const monitor = createReportMonitor({ directory, loadRecord, verifyRecord, intervalMs: monitorIntervalMs, freshnessMs, now });
  const response = (res, status, data) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') return response(res, 200, { service: 'proofguard-report-vault', status: 'listening', chainVerified: false });
    if (!authenticate(req.headers.authorization)) return response(res, 401, { error: 'UNAUTHORIZED' });
    // No browser sessions or cross-origin writes. Use the configured MCP adapter.
    if (req.headers.origin) return response(res, 403, { error: 'BROWSER_ORIGIN_NOT_ALLOWED' });
    if (inFlight >= maxConcurrent) return response(res, 429, { error: 'SERVICE_BUSY' });
    inFlight++;
    try {
      if (req.method === 'POST' && req.url === '/v1/reports') {
        requireThat(req.headers['content-type']?.split(';')[0] === 'application/json', 'JSON_REQUIRED');
        let body = '';
        for await (const chunk of req) {
          body += chunk.toString('utf8');
          requireThat(Buffer.byteLength(body) <= 4096, 'REQUEST_TOO_LARGE');
        }
        let input;
        try { input = z.object(deliveryInput).strict().parse(JSON.parse(body)); } catch { throw Error('INVALID_DELIVERY_INPUT'); }
        const output = await verify(input);
        const id = sha256(canonical({ chainId: output.chainId, contract: output.contract.toLowerCase(), sourceId: output.source.id,
          workflowId: input.workflowId, jobId: input.jobId, outputSha256: output.sha256 }));
        const record = { schema: 'proofguard-delivery/1.0', id, admittedAt: new Date().toISOString(), verifiedAt: output.observedAt,
          input, chainId: output.chainId, contract: output.contract, sourceId: output.source.id, outputSha256: output.sha256, outputJson: output.outputJson,
          effect: 'REPORT_STORED', externalOrder: 'NOT_SUBMITTED', externalPayment: 'NOT_SUBMITTED' };
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const target = path.join(directory, `${id}.json`), temporary = path.join(directory, `${id}.${randomBytes(12).toString('hex')}.tmp`);
        let reused = false;
        try {
          await fs.writeFile(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600, flush: true });
          // Link is an atomic create-if-absent. A crash leaves no partial report.
          try { await fs.link(temporary, target); }
          catch (error) { if (error.code !== 'EEXIST') throw error; reused = true; }
        } finally { await fs.rm(temporary, { force: true }); }
        const stored = JSON.parse(await fs.readFile(target, 'utf8'));
        requireThat(stored.id === id && stored.outputSha256 === output.sha256 && stored.outputJson === output.outputJson && canonical(stored.input) === canonical(input), 'STORED_RECORD_MISMATCH');
        const monitoring = await monitor.admitted(id, output.vaultCheckStartedAt);
        requireThat(monitoring.state === 'CURRENT', monitoring.reason);
        return response(res, reused ? 200 : 201, { state: 'REPORT_STORED', id, reused, outputSha256: output.sha256,
          admittedAt: stored.admittedAt, verifiedAt: output.observedAt, contentPath: `/v1/reports/${id}/content`,
          boundary: 'Stored after an independent finalized RPC read. No purchase, payment or atomic cross-system lock. Downloads recheck the current source.' });
      }
      const monitoringRoute = /^\/v1\/reports\/([a-f0-9]{64})\/(status|recheck|events)(?:\?(.*))?$/.exec(req.url || '');
      if (monitoringRoute) {
        const [, id, operation, query] = monitoringRoute;
        if (operation === 'status' && req.method === 'GET') {
          requireThat(query === undefined, 'INVALID_MONITOR_QUERY');
          return response(res, 200, await monitor.status(id));
        }
        if (operation === 'recheck' && req.method === 'POST') {
          requireThat(query === undefined, 'INVALID_MONITOR_QUERY');
          for await (const chunk of req) requireThat(chunk.length === 0, 'INVALID_RECHECK_INPUT');
          return response(res, 200, await monitor.recheck(id));
        }
        if (operation === 'events' && req.method === 'GET') {
          const params = new URLSearchParams(query || '');
          requireThat([...params.keys()].every(key => ['after', 'limit'].includes(key))
            && params.getAll('after').length <= 1 && params.getAll('limit').length <= 1, 'INVALID_EVENT_QUERY');
          const integer = (key, fallback) => {
            const value = params.get(key);
            requireThat(value === null || /^(0|[1-9][0-9]*)$/.test(value), 'INVALID_EVENT_QUERY');
            return value === null ? fallback : Number(value);
          };
          return response(res, 200, await monitor.events(id, { after: integer('after', 0), limit: integer('limit', 50) }));
        }
      }
      const match = /^\/v1\/reports\/([a-f0-9]{64})(\/content)?$/.exec(req.url || '');
      if (req.method === 'GET' && match) {
        const { record, output } = await monitor.verifyCurrent(match[1]);
        if (match[2]) {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${match[1]}.json"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          return res.end(output.outputJson);
        }
        return response(res, 200, { state: 'REPORT_STORED', id: record.id, admittedAt: record.admittedAt, verifiedAt: output.observedAt, outputSha256: output.sha256 });
      }
      response(res, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      const code = /^[A-Z_]+$/.test(error?.message) ? error.message : 'VAULT_OPERATION_FAILED';
      response(res, code === 'REPORT_NOT_FOUND' ? 404 : 409, { state: 'DELIVERY_BLOCKED', error: code });
    } finally { inFlight--; }
  });
  server.reportMonitor = monitor;
  server.on('listening', () => monitor.start());
  server.on('close', () => { void monitor.stop(); });
  const close = server.close.bind(server);
  server.close = callback => {
    const finished = monitor.stop();
    return close(error => { void finished.then(() => callback?.(error)); });
  };
  return server;
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: node services/report-vault.mjs --network studio-next|studionet --contract 0x... --source SOURCE-ID\nRequires PROOFGUARD_REPORT_TOKEN, PROOFGUARD_REPORT_DIR, PROOFGUARD_REPORT_WORKFLOWS (comma-separated). Listens on 127.0.0.1:8788; optional PROOFGUARD_REPORT_PORT. No wallet key. See docs/REPORT_VAULT.md.');
  } else {
    try {
      requireThat(process.argv.slice(2).length === 6, 'INVALID_CONFIGURATION');
      const { configuredInspector } = await import('../agents/mcp-server.mjs');
      const inspector = await configuredInspector(process.argv.slice(2));
      const port = Number(process.env.PROOFGUARD_REPORT_PORT || 8788);
      requireThat(Number.isInteger(port) && port > 0 && port <= 65535, 'INVALID_PORT');
      const server = createReportVault({ inspector, token: process.env.PROOFGUARD_REPORT_TOKEN,
        directory: process.env.PROOFGUARD_REPORT_DIR, allowedWorkflows: (process.env.PROOFGUARD_REPORT_WORKFLOWS || '').split(',').filter(Boolean),
        monitorIntervalMs: Number(process.env.PROOFGUARD_REPORT_MONITOR_INTERVAL_MS || 60_000),
        freshnessMs: Number(process.env.PROOFGUARD_REPORT_FRESHNESS_MS || 120_000) });
      server.on('error', () => { console.error('Report vault could not listen.'); process.exitCode = 1; });
      server.listen(port, '127.0.0.1', () => console.error(`ProofGuard report vault listening on 127.0.0.1:${port}`));
    } catch { console.error('Report vault configuration is invalid. Run with --help.'); process.exitCode = 1; }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
