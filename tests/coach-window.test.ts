import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { deferred } from './support/fixtures.ts';

class FixtureWindow extends EventEmitter {
  static all: FixtureWindow[] = [];
  destroyed = false;
  minimized = false;
  visible = false;
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
}

Object.defineProperty(globalThis, '__dirname', { value: 'fixture-main' });
mock.module('electron', { namedExports: { BrowserWindow: FixtureWindow } });
const { CoachWindow } = await import('../src/main/coach-window.ts');

test('読込中も窓を重複作成せず、closeで隠し同じ窓を復元する', async () => {
  const manager = new CoachWindow();
  const loading = deferred<void>();
  let loads = 0;
  let quitting = false;
  const load = async () => { loads++; await loading.promise; };
  const pending = manager.create(load, () => quitting);
  const window = FixtureWindow.all.at(-1)!;
  assert.equal(await manager.create(load, () => quitting), manager.current);
  assert.equal(loads, 1);
  loading.resolve(); await pending;
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

test('窓の隔離設定と外部遷移拒否を維持する', async () => {
  const manager = new CoachWindow();
  await manager.create(async (_window, mode) => { assert.equal(mode, 'coach'); }, () => false);
  const window = FixtureWindow.all.at(-1)!;
  assert.deepEqual(window.options.webPreferences, {
    preload: window.options.webPreferences?.preload, contextIsolation: true, nodeIntegration: false, sandbox: true
  });
  assert.equal(window.options.show, false);
  assert.deepEqual(window.openHandler?.(), { action: 'deny' });
  const event = { preventDefault: mock.fn() };
  window.webContents.emit('will-navigate', event);
  assert.equal(event.preventDefault.mock.callCount(), 1);
});
