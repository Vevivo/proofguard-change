import test from 'node:test';
import assert from 'node:assert/strict';
import { networkActivityState, networkActivityTitle } from '../genlayer/change-network-activity.mjs';

test('a finalized write stays in reading state until the source refresh finishes', () => {
  const progress = { hash:'0xabc', finalized:true, method:'execute_action' };
  assert.equal(networkActivityState({progress,busy:true}), 'refreshing');
  assert.equal(networkActivityState({progress,busy:false}), 'success');
  assert.equal(networkActivityTitle('success',progress.method), 'Output created');
});

test('a failed state read after finality never presents a successful completion', () => {
  assert.equal(networkActivityState({progress:{finalized:true},busy:false,error:'Read timed out'}), 'attention');
});

test('a submitted hash and a recoverable timeout never imply success', () => {
  assert.equal(networkActivityState({progress:{hash:'0xabc'},busy:true}), 'pending');
  assert.equal(networkActivityState({progress:{hash:'0xabc',recoverable:true},busy:false,pending:{hash:'0xabc'}}), 'attention');
});

test('a restored pending transaction asks for a check, rather than appearing active', () => {
  assert.equal(networkActivityState({progress:{hash:'0xabc'},pending:{hash:'0xabc'},busy:false}), 'attention');
});

test('a declined wallet request and an execution error stay failed', () => {
  assert.equal(networkActivityState({busy:false,error:'User rejected request'}), 'failed');
  assert.equal(networkActivityState({progress:{hash:'0xabc',failed:true},busy:false}), 'failed');
});

test('read-only work and wallet preparation cannot invent a finalized transaction', () => {
  assert.equal(networkActivityState({busy:true}), 'preparing');
  assert.equal(networkActivityState({busy:false}), null);
  assert.equal(networkActivityState({busy:false,progress:{label:'Preparing'}}), null);
});

test('recording permission is a different completion from generating an output', () => {
  assert.equal(networkActivityTitle('success','authorize_action'), 'Permission recorded');
  assert.equal(networkActivityTitle('success','review_source'), 'Review complete');
});
