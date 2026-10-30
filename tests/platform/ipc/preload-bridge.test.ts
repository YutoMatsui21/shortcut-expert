import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { CoachBridge, Snapshot } from '../src/shared/coach.ts';

const renderer = new EventEmitter();
const invoke = mock.fn(async (..._args: unknown[]) => {});
let bridge: CoachBridge;
mock.module('electron', { namedExports: {
  ipcRenderer: Object.assign(renderer, { invoke }),
  contextBridge: { exposeInMainWorld: (name: string, value: CoachBridge) => { assert.equal(name, 'coach'); bridge = value; } }
} });
await import('../src/preload/index.ts');
test('delete confirmation has dedicated request, cancellation and token-only commit channels', async () => {
  await bridge.requestDelete();
  assert.deepEqual(invoke.mock.calls.at(-1)?.arguments, ['coach:request-delete']);
  await bridge.cancelDelete('token');
  assert.deepEqual(invoke.mock.calls.at(-1)?.arguments, ['coach:cancel-delete', 'token']);
  await bridge.deleteCounts('token');
  assert.deepEqual(invoke.mock.calls.at(-1)?.arguments, ['coach:delete', 'token']);
});
test('record summary exposes only period/filter/sort for a bounded query', async () => {
  await bridge.getRecordSummary();
  assert.deepEqual(invoke.mock.calls.at(-1)?.arguments, ['coach:get-record-summary', undefined]);
  await bridge.getRecordSummary({period:30,filter:'all',sort:'total'});
  assert.deepEqual(invoke.mock.calls.at(-1)?.arguments, ['coach:get-record-summary', {period:30,filter:'all',sort:'total'}]);
});
test('three-state changes use only the limited IPC channel and arguments', async () => {
  await bridge.setLearningState('W12', 'mastered');
  assert.deepEqual(invoke.mock.calls.at(-1)?.arguments, ['coach:set-learning-state', 'W12', 'mastered']);
});

test('状態の再購読と解除で他の購読を消さず、解除後の通知も残さない', () => {
  const receive = mock.fn();
  const other = mock.fn();
  const unsubscribe = bridge.subscribe(receive);
  const unsubscribeOther = bridge.subscribe(other);
  const snapshot: Snapshot = { counts: {}, settings: { opened: true, muted: [] },
    observing: true, notificationsPaused: false, error: null, pendingSave: false };
  renderer.emit('coach:changed', {}, snapshot);
  assert.equal(receive.mock.callCount(), 1);
  assert.deepEqual(receive.mock.calls[0].arguments, [snapshot]);
  unsubscribe(); unsubscribe();
  const unsubscribeAgain = bridge.subscribe(receive);
  renderer.emit('coach:changed', {}, snapshot);
  assert.equal(receive.mock.callCount(), 2);
  assert.equal(other.mock.callCount(), 2);
  unsubscribeAgain(); unsubscribeOther();
  assert.equal(renderer.listenerCount('coach:changed'), 0);
  renderer.emit('coach:changed', {}, snapshot);
  assert.equal(receive.mock.callCount(), 2);
});
