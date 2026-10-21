import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { deferred } from './support/fixtures.ts';

class FixtureWindow extends EventEmitter {
  static all: FixtureWindow[] = [];
  destroyed = false;
  minimized = false;
  maximized = false;
  visible = false;
  bounds = { x: 100, y: 100, width: 1120, height: 700 };
  getNormalBounds() { return { ...this.bounds }; }
  setBounds(bounds: typeof this.bounds) { this.bounds = bounds; this.emit('resize'); }
  calls: string[] = [];
  openHandler?: () => { action: string };
  sent: unknown[][] = [];
  webContents = Object.assign(new EventEmitter(), {
    setWindowOpenHandler: (handler: () => { action: string }) => { this.openHandler = handler; },
    send: (...args: unknown[]) => { this.sent.push(args); }
  });
  readonly options: Electron.BrowserWindowConstructorOptions;
  constructor(options: Electron.BrowserWindowConstructorOptions) { super(); this.options = options; FixtureWindow.all.push(this); }
  isDestroyed() { return this.destroyed; }
  isMinimized() { return this.minimized; }
  restore() { this.calls.push('restore'); this.minimized = false; }
  show() { this.calls.push('show'); this.visible = true; }
  focus() { this.calls.push('focus'); }
  hide() { this.visible = false; }
  minimize() { this.minimized = true; }
  isMaximized() { return this.maximized; }
  maximize() { this.maximized = true; this.emit('maximize'); }
  unmaximize() { this.maximized = false; this.emit('unmaximize'); }
}

Object.defineProperty(globalThis, '__dirname', { value: 'fixture-main' });
mock.module('electron', { namedExports: { BrowserWindow: FixtureWindow } });
const { CoachWindow } = await import('../src/main/coach-window.ts');

test('読込中も窓を重複作成せず、closeで隠し同じ窓を復元する', async () => {
  const manager = new CoachWindow();
  manager.show();
  const loading = deferred<void>();
  let loads = 0;
  let quitting = false;
  const load = async () => { loads++; await loading.promise; };
  const pending = manager.create(load, () => quitting);
  const window = FixtureWindow.all.at(-1)!;
  assert.equal(await manager.create(load, () => quitting), manager.current);
  assert.equal(loads, 1);
  manager.show(); manager.show();
  assert.equal(window.visible, false, 'activation must wait for the renderer to finish loading');
  loading.resolve(); await pending;
  assert.equal(window.visible, true, 'early activation is restored after safe initialization and load');
  assert.deepEqual(window.calls, ['show', 'focus']);
  const event = { preventDefault: mock.fn() };
  manager.show();
  window.emit('close', event);
  assert.equal(event.preventDefault.mock.callCount(), 1);
  assert.equal(window.visible, false);
  assert.equal(window.destroyed, false);
  window.calls = []; window.minimized = true;
  manager.show(); manager.show();
  assert.deepEqual(window.calls, ['restore', 'show', 'focus', 'show', 'focus']);
  assert.equal(loads, 1);
  quitting = true;
  window.emit('close', event);
  assert.equal(event.preventDefault.mock.callCount(), 1, '終了時はcloseを妨げない');
  window.destroyed = true; window.emit('closed');
  assert.equal(manager.current, null);
  manager.show(); manager.hide();
});

test('normal DIP bounds survive state changes; maximize/minimize events never overwrite them; flush drains save', async () => {
  const manager = new CoachWindow();
  const saved: unknown[] = [];
  const writing = deferred<void>();
  await manager.create(async () => {}, () => false, { workAreas: () => [{ x: -1920, y: 0, width: 1920, height: 1080 }],
    saved: { x: -1800, y: 80, width: 900, height: 650 }, save: async bounds => { saved.push(bounds); await writing.promise; } });
  const window = FixtureWindow.all.at(-1)!;
  assert.equal(window.options.x, -1800);
  window.bounds = { x: -1600, y: 100, width: 1000, height: 660 }; window.emit('move');
  window.maximized = true; window.bounds = { x: -1920, y: 0, width: 1920, height: 1080 }; window.emit('resize');
  window.maximized = false; window.minimized = true; window.bounds = { x: -32000, y: -32000, width: 800, height: 600 }; window.emit('move');
  let completed = false;
  const flush = manager.flush(true).then(() => { completed = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(completed, false);
  assert.deepEqual(saved, [{ x: -1600, y: 100, width: 1000, height: 660 }]);
  writing.resolve(); await flush;
  window.minimized = false; window.emit('move'); await manager.flush();
  assert.equal(saved.length, 1, 'disposed window cannot enqueue a late write');
});

test('display removal corrects the normal rectangle and retains maximized/minimized state', async () => {
  const manager = new CoachWindow();
  await manager.create(async () => {}, () => false, { workAreas: () => [{ x: 0, y: 0, width: 1280, height: 720 }], save: async () => {} });
  const window = FixtureWindow.all.at(-1)!;
  window.bounds = { x: -1800, y: 50, width: 1000, height: 650 };
  window.maximized = true;
  manager.correctBounds();
  assert.equal(window.maximized, true);
  assert.deepEqual(window.bounds, { x: 0, y: 50, width: 1000, height: 650 });
  await manager.flush(true);
});

test('a rejected bounds save can retry the same value and accept later moves', async () => {
  const manager = new CoachWindow();
  let fail = true;
  const saved: unknown[] = [];
  await manager.create(async () => {}, () => false, { workAreas: () => [{ x: 0, y: 0, width: 1920, height: 1080 }],
    save: async bounds => { if (fail) throw new Error('fixture-write'); saved.push(bounds); } });
  const window = FixtureWindow.all.at(-1)!;
  window.bounds = { x: 100, y: 100, width: 1000, height: 650 }; window.emit('resize');
  await assert.rejects(manager.flush(true), /fixture-write/);
  fail = false; manager.resumeBounds();
  await manager.flush();
  assert.deepEqual(saved, [{ x: 100, y: 100, width: 1000, height: 650 }]);
  window.bounds = { ...window.bounds, x: 120 }; window.emit('move');
  await manager.flush(true);
  assert.equal(saved.length, 2);
});

test('窓の隔離設定と外部遷移拒否を維持する', async () => {
  const manager = new CoachWindow();
  await manager.create(async (_window, mode) => { assert.equal(mode, 'coach'); }, () => false);
  const window = FixtureWindow.all.at(-1)!;
  const snapshot = { counts: {}, settings: { muted: [], opened: false }, observing: true, notificationsPaused: false, error: null, pendingSave: false };
  manager.publish(snapshot);
  const older = manager.withWindowState(snapshot);
  manager.publish({ ...snapshot, observing: false });
  assert.ok(manager.withWindowState(snapshot).stateVersion! > older.stateVersion!);
  assert.deepEqual(window.options.webPreferences, {
    preload: window.options.webPreferences?.preload, contextIsolation: true, nodeIntegration: false, sandbox: true
  });
  assert.equal(window.options.show, false);
  assert.equal(window.options.frame, false);
  assert.equal(window.options.width, 1120); assert.equal(window.options.height, 700);
  assert.equal(window.options.minWidth, 800); assert.equal(window.options.minHeight, 600);
  manager.command('minimize'); assert.equal(window.minimized, true);
  manager.command('maximize'); assert.equal(window.maximized, true);
  manager.command('maximize'); assert.equal(window.maximized, false);
  manager.show(); manager.command('hide'); assert.equal(window.visible, false);
  assert.deepEqual(window.openHandler?.(), { action: 'deny' });
  const event = { preventDefault: mock.fn() };
  window.webContents.emit('will-navigate', event);
  assert.equal(event.preventDefault.mock.callCount(), 1);
});
