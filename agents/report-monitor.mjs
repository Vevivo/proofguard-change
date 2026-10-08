import { z } from 'zod';
import { validServiceToken } from '../services/report-vault.mjs';

const deliveryId = z.string().regex(/^[a-f0-9]{64}$/);
const cursor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.string().datetime().nullable();
const observation = {
  state: z.enum(['CURRENT', 'INVALIDATED', 'UNVERIFIABLE']),
  reason: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
  checkedAt: timestamp, validUntil: timestamp,
};
export const reportMonitorInputs = {
  status: { deliveryId }, recheck: { deliveryId },
  events: { deliveryId, after: cursor.optional(), limit: z.number().int().min(1).max(100).optional() },
};
const statusSchema = z.object({ deliveryId, ...observation, lastEventSequence: cursor });
const eventSchema = z.object({ sequence: cursor.min(1), at: z.string().datetime(), ...observation });
const eventsSchema = z.object({ deliveryId, events: z.array(eventSchema).max(100), nextCursor: cursor, hasMore: z.boolean() });

/** The agent supplies only a receipt ID and a bounded cursor, never a destination. */
export function createReportMonitorClient({ endpoint, token, fetcher = fetch, now = Date.now }) {
  let origin;
  try { origin = new URL(endpoint); } catch { throw Error('INVALID_REPORT_ENDPOINT'); }
  if (origin.username || origin.password || origin.hash || origin.search || origin.pathname !== '/' ||
      !(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(origin.hostname)))) throw Error('INVALID_REPORT_ENDPOINT');
  if (!validServiceToken(token)) throw Error('REPORT_TOKEN_REQUIRED');
  async function request(route, method = 'GET') {
    let response, text = '';
    try {
      response = await fetcher(new URL(route, origin), { method, redirect: 'error',
        headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(55000) });
      for await (const chunk of response.body) {
        text += Buffer.from(chunk).toString('utf8');
        if (Buffer.byteLength(text) > 131072) throw Error('RESPONSE_TOO_LARGE');
      }
    } catch { throw Error('REPORT_MONITOR_UNAVAILABLE'); }
    let data;
    try { data = JSON.parse(text); } catch { throw Error('INVALID_MONITOR_RESPONSE'); }
    if (!response.ok) throw Error('REPORT_MONITOR_REJECTED');
    return data;
  }
  function status(data, id) {
    const parsed = statusSchema.safeParse(data);
    if (!parsed.success || parsed.data.deliveryId !== id) throw Error('INVALID_MONITOR_RESPONSE');
    const result = parsed.data;
    if (result.state === 'CURRENT') {
      if (!result.checkedAt || !result.validUntil || Date.parse(result.validUntil) <= Date.parse(result.checkedAt)) throw Error('INVALID_MONITOR_RESPONSE');
      // An observation may expire in transit. Never surface it as current then.
      if (Date.parse(result.validUntil) <= now() || Date.parse(result.checkedAt) > now()) {
        result.state = 'UNVERIFIABLE'; result.reason = 'CHECK_EXPIRED';
      }
    }
    return { ...result, guidance: 'This is a bounded-time vault observation, not an execution permit. Downloads independently recheck finalized state. Previously downloaded copies cannot be recalled.' };
  }
  return {
    status: async raw => {
      const input = z.object(reportMonitorInputs.status).strict().parse(raw);
      return status(await request(`/v1/reports/${input.deliveryId}/status`), input.deliveryId);
    },
    recheck: async raw => {
      const input = z.object(reportMonitorInputs.recheck).strict().parse(raw);
      return status(await request(`/v1/reports/${input.deliveryId}/recheck`, 'POST'), input.deliveryId);
    },
    events: async raw => {
      const input = z.object(reportMonitorInputs.events).strict().parse(raw), after = input.after ?? 0, limit = input.limit ?? 50;
      const parsed = eventsSchema.safeParse(await request(`/v1/reports/${input.deliveryId}/events?after=${after}&limit=${limit}`));
      if (!parsed.success || parsed.data.deliveryId !== input.deliveryId) throw Error('INVALID_MONITOR_RESPONSE');
      const result = parsed.data;
      if (result.events.length > limit || (result.hasMore && !result.events.length)) throw Error('INVALID_MONITOR_RESPONSE');
      let previous = after;
      for (const event of result.events) {
        if (event.sequence <= previous) throw Error('INVALID_MONITOR_RESPONSE');
        previous = event.sequence;
      }
      if (result.nextCursor !== previous) throw Error('INVALID_MONITOR_RESPONSE');
      return { ...result, guidance: 'Historical observations in service order. A past CURRENT event is not a current approval; read report status and its validity window.' };
    },
  };
}
