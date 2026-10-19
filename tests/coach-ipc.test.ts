import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { CoachBridge, Snapshot } from '../src/shared/coach.ts';

type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
mock.module('electron', { namedExports: { ipcMain: { handle: (channel: string, handler: Handler) => {
  assert.equal(handlers.has(channel), false); handlers.set(channel, handler);
} } } });
const { registerCoachIpc } = await import('../src/main/coach-ipc.ts');

test('正規の要求だけ実行し、別窓・子frame・不正な引数を副作用の前に拒否する', async () => {
  // Only Electron's identity boundary is faked; registration and validation are production code.
  const mainFrame = {};
  const contents = { id: 1, mainFrame };
  const notice = { id: 2, mainFrame: {} };
  const event = { sender: contents, senderFrame: mainFrame } as Electron.IpcMainInvokeEvent;
  const noticeEvent = { sender: notice, senderFrame: notice.mainFrame } as Electron.IpcMainInvokeEvent;
  const snapshot: Snapshot = { counts: {}, settings: { muted: [], opened: true },
    observing: true, notificationsPaused: false, error: null, pendingSave: false };
  const requests = {
    getLearning: mock.fn(async () => ({ from: '2026-10-13', to: '2026-10-19', revision: 0, rows: [] })),
    windowCommand: mock.fn(async () => {}),
    getRecords: mock.fn(async () => ({ counts: {}, coverage: {}, revision: 0 })),
    getSnapshot: mock.fn(async () => snapshot), getNotice: mock.fn(async () => null),
    command: mock.fn<CoachBridge['command']>(async () => snapshot),
    setMuted: mock.fn<CoachBridge['setMuted']>(async () => snapshot),
    setLearningState: mock.fn<CoachBridge['setLearningState']>(async () => snapshot),
    deleteCounts: mock.fn(async () => snapshot)
  };
  registerCoachIpc(() => ({ webContents: contents }) as Electron.BrowserWindow, (id) => id === 2, requests);
  assert.equal(handlers.size, 9);
  const invoke = (channel: string, from: Electron.IpcMainInvokeEvent, ...args: unknown[]) => handlers.get(channel)!(from, ...args);
  for (const channel of handlers.keys()) {
    const sender = channel === 'coach:get-notice' ? noticeEvent : event;
    const args = channel === 'coach:set-learning-state' ? ['W13', 'mastered'] : channel === 'coach:window' ? ['hide'] : channel === 'coach:command' ? ['stop'] : channel === 'coach:set-muted' ? ['W03', true] : channel === 'coach:get-records' ? ['2026-10-01', '2026-10-19'] : [];
    assert.throws(() => invoke(channel, { ...sender, senderFrame: {} } as Electron.IpcMainInvokeEvent, ...args), /Unknown sender/);
    assert.throws(() => invoke(channel, channel === 'coach:get-notice' ? event : noticeEvent, ...args), /Unknown sender/);
    await invoke(channel, sender, ...args);
  }
  for (const value of [null, {}, 'unknown', 1]) assert.throws(() => invoke('coach:command', event, value), /Unknown command/);
  for (const value of [null, {}, 'quit', 1]) assert.throws(() => invoke('coach:window', event, value), /Unknown window command/);
  assert.equal(requests.windowCommand.mock.callCount(), 1);
  assert.equal(requests.getLearning.mock.callCount(), 1);
  for (const args of [[null, '2026-10-19'], ['2026-02-30', '2026-03-01'], ['2020-01-01', '2026-10-19'], ['2026-10-19', '2026-10-01']]) {
    assert.throws(() => invoke('coach:get-records', event, ...args), /Invalid range/);
  }
  for (const args of [['W99', true], ['W03', 'true'], [null, false]]) {
    assert.throws(() => invoke('coach:set-muted', event, ...args), /Invalid setting/);
  }
  assert.equal(requests.command.mock.callCount(), 1);
  for (const args of [['W09', 'learning'], ['W14', 'excluded'], ['W99', 'learning'], ['W03', 'automatic'], ['W03', {}], [null, 'learning']]) {
    assert.throws(() => invoke('coach:set-learning-state', event, ...args), /Invalid learning state/);
  }
  assert.deepEqual(requests.setLearningState.mock.calls[0].arguments, ['W13', 'mastered']);
  assert.equal(requests.setLearningState.mock.callCount(), 1);
  assert.equal(requests.setMuted.mock.callCount(), 1);
  assert.deepEqual(requests.command.mock.calls[0].arguments, ['stop']);
  assert.deepEqual(requests.setMuted.mock.calls[0].arguments, ['W03', true]);
});
