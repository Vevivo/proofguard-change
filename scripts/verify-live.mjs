#!/usr/bin/env node
// Read-only verification. No wallet, key, faucet, deployment or write call.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from 'genlayer-studionet';
import { studionet } from 'genlayer-studionet/chains';
import { TransactionHashVariant, transactionsStatusNumberToName } from 'genlayer-studionet/types';
import { transactionExecutionOutcome } from '../genlayer/change-transaction.mjs';

const reference = JSON.parse(await readFile(new URL('../deployments/studionet.json', import.meta.url), 'utf8'));
const expectedCode = await readFile(new URL('../contracts/genlayer/change_network.py', import.meta.url), 'utf8');
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
assert.equal(digest(expectedCode), reference.contractSourceSha256, 'Local source differs from the reference deployment');
const client = createClient({ chain: studionet });
const timeout = setTimeout(() => { console.error('Read timed out; no transaction was submitted.'); process.exit(1); }, 60_000);
try {
  const args = { address: reference.contract, transactionHashVariant: TransactionHashVariant.LATEST_FINAL };
  const [code, policy, raw, transaction] = await Promise.all([
    client.getContractCode(reference.contract),
    client.readContract({ ...args, functionName: 'get_policy', args: [] }),
    client.readContract({ ...args, functionName: 'get_source_bundle', args: [reference.sourceId] }),
    client.getTransaction({ hash: reference.reviewTransaction }),
  ]);
  assert.equal(code, expectedCode, 'Deployed contract source mismatch');
  assert.equal(policy, reference.policy, 'Policy mismatch');
  const status = typeof transaction.status === 'number' ? transactionsStatusNumberToName[transaction.status] : transaction.status;
  const outcome = transactionExecutionOutcome(transaction);
  assert.equal(status, 'FINALIZED', 'Reference review is not finalized');
  assert.equal(outcome.state, 'success', 'Reference review execution is not confirmed successful');
  const bundle = JSON.parse(raw);
  assert.equal(bundle.source.id, reference.sourceId, 'Source ID mismatch');
  for (const version of bundle.source.versions) assert.equal(digest(version.text), version.sha256, 'Source digest mismatch');
  for (const workflow of bundle.workflows) for (const job of workflow.actions) {
    assert.equal(digest(job.intent_json), job.intent_hash, 'Intent digest mismatch');
    if (job.execution) assert.equal(digest(job.execution.output_json), job.execution.output_sha256, 'Output digest mismatch');
  }
  console.log(JSON.stringify({
    observedAt: new Date().toISOString(), readState: 'LATEST_FINAL',
    contract: reference.contract, chainId: studionet.id,
    codeMatches: true, policy, integrityChecksPassed: true,
    reviewTransaction: { hash: reference.reviewTransaction, status, outcome: outcome.state },
    source: { id: bundle.source.id, revision: bundle.source.revision },
    workflows: bundle.workflows.map(workflow => ({
      id: workflow.id, reviewedRevision: workflow.reviewed_revision,
      jobs: workflow.actions.map(job => ({ id: job.id, gate: job.gate, permits: job.permits.length,
        output: job.execution ? { id: job.execution.id, sha256: job.execution.output_sha256 } : null })),
    })),
  }, null, 2));
} finally { clearTimeout(timeout); }
