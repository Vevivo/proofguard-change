import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from './inspector.mjs';
import { trackSubmittedTransaction, TransactionExecutionFailed } from '../genlayer/change-transaction.mjs';

/** Local, durable intent journal. A missing hash after submission is deliberately
 * unresolved: an ambiguous provider error must not become a second transaction.
 */
export function fileExecutionJournal(directory) {
  const filename = key => path.join(directory, `${key}.json`);
  return {
    async read(key) {
      try { return JSON.parse(await fs.readFile(filename(key), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return null; throw Error('EXECUTION_JOURNAL_UNAVAILABLE'); }
    },
    async claim(key, value) {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      try { await fs.writeFile(filename(key), JSON.stringify(value), { flag: 'wx', mode: 0o600, flush: true }); return true; }
      catch (error) { if (error.code === 'EEXIST') return false; throw Error('EXECUTION_JOURNAL_UNAVAILABLE'); }
    },
    async update(key, value) {
      const temporary = `${filename(key)}.${process.pid}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600, flush: true });
      await fs.rename(temporary, filename(key));
    },
  };
}

export function createApprovedExecutor({ inspector, client, account, journal, finalize = hash => trackSubmittedTransaction({
  hash, read: h => client.getTransaction({ hash: h }), onProgress: () => {}, maxDurationMs: 45000,
}) }) {
  const active = new Set();
  return async ({ workflowId, jobId, expectedRevision, expectedIntentHash }) => {
    const operation = `${workflowId}/${jobId}`;
    if (active.has(operation)) throw Error('EXECUTION_IN_PROGRESS');
    active.add(operation);
    try {
      const current = await inspector.inspectWorkflow({ workflowId, expectedRevision });
      if (current.chainId !== 61999) throw Error('EXECUTION_REQUIRES_STUDIONET');
      const job = current.workflow.jobs.find(j => j.id === jobId);
      if (!job || job.intentHash !== expectedIntentHash) throw Error('INTENT_MISMATCH');
      if (current.workflow.executor.toLowerCase() !== account.toLowerCase()) throw Error('EXECUTOR_MISMATCH');
      if (job.state === 'OUTPUT_CREATED') return { state: 'OUTPUT_CREATED', reused: true, ...await inspector.getOutput({ workflowId, jobId, expectedRevision }) };
      const binding = { chainId: current.chainId, contract: current.contract, sourceId: current.source.id, workflowId, jobId, expectedRevision, expectedIntentHash };
      // A workflow job creates at most one artifact, across all source revisions.
      const key = sha256(JSON.stringify([current.chainId, current.contract.toLowerCase(), current.source.id, workflowId, jobId]));
      let saved = await journal.read(key);
      if (!saved) {
        if (job.state !== 'READY_FOR_CONTRACT_EXECUTION') throw Error(job.state);
        saved = { ...binding, state: 'SUBMITTING' };
        if (!await journal.claim(key, saved)) throw Error('EXECUTION_IN_PROGRESS');
        // Only this fixed method is available. The contract atomically rechecks
        // owner permit, executor, source revision and intent before producing output.
        try {
          const hash = String(await client.writeContract({ address: current.contract, functionName: 'execute_action',
            args: [workflowId, jobId, BigInt(expectedRevision), expectedIntentHash], value: 0n }));
          if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw Error();
          saved = { ...saved, state: 'SUBMITTED', hash };
          await journal.update(key, saved);
        } catch { throw Error('SUBMISSION_OUTCOME_UNKNOWN'); }
      }
      if (saved.expectedRevision !== expectedRevision || saved.expectedIntentHash !== expectedIntentHash) throw Error('PREVIOUS_EXECUTION_NEEDS_RECONCILIATION');
      if (!/^0x[0-9a-f]{64}$/i.test(saved.hash || '')) throw Error('SUBMISSION_OUTCOME_UNKNOWN');
      const transactionHash = saved.hash;
      try { await finalize(transactionHash); }
      catch (error) {
        const failed = error instanceof TransactionExecutionFailed;
        return { state: failed ? 'EXECUTION_FAILED' : 'EXECUTION_PENDING', transactionHash,
          guidance: failed ? 'Inspect the transaction. This journal will not submit another write. No output has been confirmed.' : 'Repeat this exact call to check the same transaction. No second write will be submitted.' };
      }
      const output = await inspector.getOutput({ workflowId, jobId, expectedRevision });
      return { state: 'OUTPUT_CREATED', reused: false, transactionHash, ...output };
    } finally { active.delete(operation); }
  };
}
