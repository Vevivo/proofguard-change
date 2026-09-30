import { createHash } from 'node:crypto';
import { createInspectorCore } from '../genlayer/inspector-core.mjs';
export { POLICY } from '../genlayer/inspector-core.mjs';
export const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
export function createInspector(options) { return createInspectorCore({ ...options, sha256 }); }
