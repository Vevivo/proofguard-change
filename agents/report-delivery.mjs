import { z } from 'zod';
import { deliveryInput, validServiceToken } from '../services/report-vault.mjs';

/** Destination and token come only from operator configuration, not an agent. */
export function createReportDelivery({ endpoint, token, fetcher = fetch }) {
  let url;
  try { url = new URL(endpoint); } catch { throw Error('INVALID_REPORT_ENDPOINT'); }
  if (url.username || url.password || url.hash || url.search || url.pathname !== '/' ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) throw Error('INVALID_REPORT_ENDPOINT');
  if (!validServiceToken(token)) throw Error('REPORT_TOKEN_REQUIRED');
  return async raw => {
    const input = z.object(deliveryInput).strict().parse(raw);
    let response;
    try { response = await fetcher(new URL('/v1/reports', url), { method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(30000) }); }
    catch { return { state: 'DELIVERY_UNCONFIRMED', guidance: 'Repeat the same delivery call. The service deduplicates the exact output. No successful delivery is established.' }; }
    let text = '';
    for await (const chunk of response.body) {
      text += Buffer.from(chunk).toString('utf8');
      if (Buffer.byteLength(text) > 8192) throw Error('INVALID_DELIVERY_RESPONSE');
    }
    let data;
    try { data = JSON.parse(text); } catch { throw Error('INVALID_DELIVERY_RESPONSE'); }
    if (!response.ok) throw Error(/^[A-Z_]+$/.test(data.error) ? data.error : 'DELIVERY_REJECTED');
    if (data.state !== 'REPORT_STORED' || !/^[a-f0-9]{64}$/.test(data.id) || data.outputSha256 !== input.expectedOutputSha256) throw Error('INVALID_DELIVERY_RESPONSE');
    // Return only bounded receipt fields; never reflect arbitrary service text.
    return { state: 'REPORT_STORED', deliveryId: data.id, outputSha256: data.outputSha256, reused: data.reused === true,
      guidance: 'The configured report vault accepted this artifact. This is not an order or payment receipt.' };
  };
}
