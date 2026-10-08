import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const reportId = /^[a-f0-9]{64}$/;
const states = new Set(['CURRENT', 'INVALIDATED', 'UNVERIFIABLE']);
const invalidationReasons = new Set(['STALE_SOURCE_REVISION', 'HISTORICAL_OUTPUT_BLOCKED']);
// Never turn arbitrary provider messages, even uppercase ones, into public history.
const reasons = new Set([
  'VERIFIED_CURRENT', 'NOT_YET_VERIFIED', 'CHECK_EXPIRED', 'VERIFICATION_FAILED',
  'STALE_SOURCE_REVISION', 'HISTORICAL_OUTPUT_BLOCKED', 'RPC_READ_FAILED', 'READ_TIMEOUT', 'READ_CANCELLED',
  'CHAIN_MISMATCH', 'CONTRACT_CODE_MISMATCH', 'POLICY_MISMATCH', 'INVALID_BUNDLE', 'INVALID_SOURCE_HISTORY',
  'SOURCE_DIGEST_MISMATCH', 'WORKFLOW_SET_MISMATCH', 'WORKFLOW_SOURCE_MISMATCH', 'INVALID_WORKFLOW_HISTORY',
  'INVALID_JOBS', 'INTENT_DIGEST_MISMATCH', 'INVALID_INTENT', 'UNKNOWN_GATE', 'EXECUTION_STATE_MISMATCH',
  'REVIEW_STATE_MISMATCH', 'PERMIT_STATE_MISMATCH', 'PERMIT_BINDING_MISMATCH', 'OUTPUT_NOT_CREATED',
  'OUTPUT_DIGEST_MISMATCH', 'OUTPUT_BINDING_MISMATCH', 'PERMIT_NOT_FOUND', 'INVALID_OUTPUT',
  'WORKFLOW_NOT_FOUND', 'JOB_NOT_FOUND', 'WORKFLOW_NOT_ALLOWED', 'UNSUPPORTED_OUTPUT',
  'STORED_RECORD_MISMATCH', 'REPORT_STORAGE_UNAVAILABLE',
]);
export const reportMonitorReasons = Object.freeze([...reasons]);
const safeReason = error => reasons.has(error?.message) ? error.message : 'VERIFICATION_FAILED';
const requireThat = (value, code) => { if (!value) throw Error(code); };
const validTime = value => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const publicStatus = state => Object.fromEntries(['deliveryId', 'state', 'reason', 'checkedAt', 'validUntil', 'lastEventSequence'].map(key => [key, state[key]]));

/** One service process owns this directory. Each report's state and complete
 * event history are committed in ONE atomic replacement, so a restart cannot
 * expose an event without its state (or vice versa). This is local audit data,
 * not a signed ledger or permission to reuse a cached report.
 */
export function createReportMonitor({ directory, loadRecord, verifyRecord, intervalMs = 60_000, freshnessMs = 120_000, now = Date.now }) {
  requireThat(Number.isSafeInteger(intervalMs) && intervalMs >= 10 && intervalMs <= 86_400_000, 'INVALID_MONITOR_INTERVAL');
  requireThat(Number.isSafeInteger(freshnessMs) && freshnessMs >= 1 && freshnessMs <= 86_400_000, 'INVALID_FRESHNESS_WINDOW');
  const monitorDirectory = path.join(directory, '.monitor');
  const queues = new Map();
  let timer, scanPromise, stopped = false;
  const timestamp = () => new Date(now()).toISOString();
  const filename = id => { requireThat(reportId.test(id), 'INVALID_REPORT_ID'); return path.join(monitorDirectory, `${id}.json`); };
  function serial(id, work) {
    filename(id);
    const previous = queues.get(id) || Promise.resolve();
    const result = previous.catch(() => {}).then(work);
    queues.set(id, result);
    void result.finally(() => { if (queues.get(id) === result) queues.delete(id); }).catch(() => {});
    return result;
  }
  function empty(id) {
    return { schema: 'proofguard-report-monitor/1.0', deliveryId: id, state: 'UNVERIFIABLE', reason: 'NOT_YET_VERIFIED', checkedAt: null, validUntil: null, lastEventSequence: 0, events: [] };
  }
  function validObservation(row) {
    return row && states.has(row.state) && reasons.has(row.reason) && validTime(row.checkedAt) && validTime(row.validUntil)
      && (row.state !== 'CURRENT' || (row.reason === 'VERIFIED_CURRENT' && row.checkedAt !== null && row.validUntil !== null && Date.parse(row.validUntil) > Date.parse(row.checkedAt)))
      && (row.state !== 'INVALIDATED' || invalidationReasons.has(row.reason));
  }
  async function read(id) {
    let raw;
    try { raw = await fs.readFile(filename(id), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return empty(id); throw Error('MONITOR_STORAGE_UNAVAILABLE'); }
    let data;
    try { data = JSON.parse(raw); } catch { throw Error('MONITOR_STATE_INVALID'); }
    requireThat(data?.schema === 'proofguard-report-monitor/1.0' && data.deliveryId === id && validObservation(data)
      && Array.isArray(data.events) && data.events.length > 0 && Number.isSafeInteger(data.lastEventSequence) && data.lastEventSequence === data.events.length
      && data.events.every((event, index) => event.sequence === index + 1 && validTime(event.at) && event.at !== null && validObservation(event))
      && data.events.at(-1).state === data.state && data.events.at(-1).reason === data.reason, 'MONITOR_STATE_INVALID');
    return data;
  }
  async function write(data) {
    const target = filename(data.deliveryId), temporary = `${target}.${randomBytes(12).toString('hex')}.tmp`;
    try {
      await fs.mkdir(monitorDirectory, { recursive: true, mode: 0o700 });
      await fs.writeFile(temporary, JSON.stringify(data), { flag: 'wx', mode: 0o600, flush: true });
      await fs.rename(temporary, target);
    } catch { throw Error('MONITOR_STORAGE_UNAVAILABLE'); }
    finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  async function transition(previous, observation) {
    // Finalized source revisions do not revert. A late or inconsistent RPC
    // observation must never revive an artifact already known to be historical.
    if (previous.state === 'INVALIDATED') return previous;
    const next = { ...previous, ...observation };
    if (!previous.lastEventSequence || previous.state !== next.state || previous.reason !== next.reason) {
      next.lastEventSequence++;
      next.events = [...previous.events, { sequence: next.lastEventSequence, at: timestamp(), state: next.state, reason: next.reason, checkedAt: next.checkedAt, validUntil: next.validUntil }];
    }
    await write(next);
    return next;
  }
  async function expire(previous) {
    if (previous.state === 'CURRENT') {
      const deadline = Math.min(Date.parse(previous.validUntil), Date.parse(previous.checkedAt) + freshnessMs);
      if (now() >= deadline || now() < Date.parse(previous.checkedAt)) {
        return transition(previous, { state: 'UNVERIFIABLE', reason: 'CHECK_EXPIRED', validUntil: new Date(deadline).toISOString() });
      }
      // A shorter operator-configured TTL also applies to persisted receipts.
      if (deadline !== Date.parse(previous.validUntil)) return transition(previous, { validUntil: new Date(deadline).toISOString() });
    }
    if (!previous.lastEventSequence) return transition(previous, {});
    return previous;
  }
  async function recordOrFailure(id, previous) {
    try { return { record: await loadRecord(id), previous }; }
    catch (error) {
      if (error.message === 'REPORT_NOT_FOUND') throw error;
      const updated = await transition(previous, { state: 'UNVERIFIABLE', reason: safeReason(error), checkedAt: timestamp(), validUntil: null });
      return { error, previous: updated };
    }
  }
  async function check(id, throwOnFailure = false) {
    return serial(id, async () => {
      const loaded = await recordOrFailure(id, await read(id));
      let { previous, record } = loaded, output, failure = loaded.error;
      if (!failure) {
        const startedAt = now();
        try { output = await verifyRecord(record, id); }
        catch (error) { failure = error; }
        if (failure) {
          const reason = safeReason(failure);
          previous = await transition(previous, { state: invalidationReasons.has(reason) ? 'INVALIDATED' : 'UNVERIFIABLE', reason, checkedAt: new Date(startedAt).toISOString(), validUntil: null });
        } else {
          previous = await transition(previous, successfulObservation(startedAt));
        }
      }
      if (throwOnFailure && (failure || previous.state !== 'CURRENT')) throw Error(previous.reason);
      return { status: publicStatus(previous), record, output };
    });
  }
  function successfulObservation(startedAt) {
    const checkedAt = new Date(startedAt).toISOString(), validUntil = new Date(startedAt + freshnessMs).toISOString();
    const expired = now() < startedAt || now() >= startedAt + freshnessMs;
    return { state: expired ? 'UNVERIFIABLE' : 'CURRENT', reason: expired ? 'CHECK_EXPIRED' : 'VERIFIED_CURRENT', checkedAt, validUntil };
  }
  const monitor = {
    async admitted(id, startedAt) {
      requireThat(Number.isFinite(startedAt) && Number.isFinite(new Date(startedAt).getTime()), 'INVALID_VERIFICATION_TIME');
      return serial(id, async () => {
        const previous = await read(id);
        // Admission verifies before a report ID/storage claim exists. It may
        // complete after a newer recheck, so never overwrite that observation.
        if (previous.checkedAt !== null && startedAt <= Date.parse(previous.checkedAt)) return publicStatus(await expire(previous));
        return publicStatus(await transition(previous, successfulObservation(startedAt)));
      });
    },
    async recheck(id) { return (await check(id)).status; },
    verifyCurrent(id) { return check(id, true); },
    status(id) {
      return serial(id, async () => {
        const loaded = await recordOrFailure(id, await read(id));
        return publicStatus(await expire(loaded.previous));
      });
    },
    events(id, { after = 0, limit = 50 } = {}) {
      requireThat(Number.isSafeInteger(after) && after >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'INVALID_EVENT_QUERY');
      return serial(id, async () => {
        const loaded = await recordOrFailure(id, await read(id));
        const state = await expire(loaded.previous);
        const events = state.events.filter(event => event.sequence > after).slice(0, limit);
        const nextCursor = events.at(-1)?.sequence ?? after;
        return { deliveryId: id, events, nextCursor, hasMore: state.lastEventSequence > nextCursor };
      });
    },
    scan() {
      if (scanPromise) return scanPromise;
      scanPromise = (async () => {
        let entries;
        try { entries = await fs.readdir(directory); }
        catch (error) { if (error.code === 'ENOENT') return []; throw Error('REPORT_STORAGE_UNAVAILABLE'); }
        const results = [];
        for (const entry of entries.sort()) {
          if (stopped) break;
          if (!/^[a-f0-9]{64}\.json$/.test(entry)) continue;
          const id = entry.slice(0, -5);
          // Expire durable observations before trying the network on startup.
          try { await monitor.status(id); results.push(await monitor.recheck(id)); }
          catch (error) { results.push({ deliveryId: id, error: ['MONITOR_STATE_INVALID', 'MONITOR_STORAGE_UNAVAILABLE', 'REPORT_NOT_FOUND'].includes(error.message) ? error.message : 'MONITOR_SCAN_FAILED' }); }
        }
        return results;
      })().finally(() => { scanPromise = null; });
      return scanPromise;
    },
    start() {
      if (timer || stopped) return;
      void monitor.scan().catch(() => {});
      timer = setInterval(() => { void monitor.scan().catch(() => {}); }, intervalMs);
      timer.unref();
    },
    async stop() {
      stopped = true;
      clearInterval(timer); timer = undefined;
      await scanPromise?.catch(() => {});
      await Promise.allSettled([...queues.values()]);
    },
  };
  return monitor;
}
