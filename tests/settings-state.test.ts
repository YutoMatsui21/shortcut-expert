import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coachTrayMenu } from '../src/main/coach-tray.ts';
import { newestSnapshot } from '../src/renderer/src/coach-snapshot.ts';
import type { Snapshot } from '../src/shared/coach.ts';

const state: Snapshot = { counts: {}, settings: { muted: [], opened: true }, observing: true,
  notificationsPaused: false, error: null, pendingSave: false, stateVersion: 1 };
test('a late initial or command reply cannot replace a newer tray/state broadcast', () => {
  const stopped = { ...state, stateVersion: 2, observing: false };
  const restarted = { ...state, stateVersion: 3, notificationsPaused: true };
  assert.equal(newestSnapshot(stopped, state), stopped);
  assert.equal(newestSnapshot(restarted, stopped), restarted);
  assert.equal(newestSnapshot(undefined, state), state);
  assert.equal(newestSnapshot(state, restarted), restarted);
});
test('tray uses the shared commands, preserves pause during stop, and blocks start with pending saves', () => {
  const commands: string[] = [];
  const menu = (snapshot: Snapshot) => coachTrayMenu(snapshot, async value => { commands.push(value); return snapshot; }, () => {}, async () => {});
  const click = (item: ReturnType<typeof menu>[number]) => item.click?.({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as Electron.KeyboardEvent);
  click(menu(state)[1]); click(menu(state)[2]);
  const paused = { ...state, observing: false, notificationsPaused: true };
  assert.equal(menu(paused)[1].enabled, false);
  assert.equal(menu(paused)[1].label, '通知を再開');
  click(menu(paused)[2]);
  assert.equal(menu({ ...paused, pendingSave: true })[2].enabled, false);
  assert.deepEqual(commands, ['pause-notifications', 'stop', 'start']);
});
