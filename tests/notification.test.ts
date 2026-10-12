import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { deferred } from './support/fixtures.ts';
import type { Notice } from '../src/shared/coach.ts';

class FixtureWindow {
  static all: FixtureWindow[] = [];
  destroyed = false;
  shown = false;
  ignored = false;
  readonly webContents = Object.assign(new EventEmitter(), {
    id: 11,
    setWindowOpenHandler: (_handler: unknown) => {}
  });
  readonly options: Electron.BrowserWindowConstructorOptions;
  constructor(options: Electron.BrowserWindowConstructorOptions) { this.options = options; FixtureWindow.all.push(this); }
  destroy() { this.destroyed = true; }
  isDestroyed() { return this.destroyed; }
  isFocusable() { return this.options.focusable ?? true; }
  setIgnoreMouseEvents(ignore: boolean) { this.ignored = ignore; }
  showInactive() { this.shown = true; }
}

const bounds = { x: -1920, y: 0, width: 1920, height: 1080 };
const display = { bounds, workArea: { ...bounds, height: 1040 } };
// Production Main is bundled as CJS; this isolated Node worker supplies its directory.
Object.defineProperty(globalThis, '__dirname', { value: 'fixture-main' });
mock.module('electron', { namedExports: {
  BrowserWindow: FixtureWindow,
  screen: { screenToDipRect: (_window: unknown, value: unknown) => value, getDisplayMatching: () => display }
} });
const { NotificationWindow } = await import('../src/main/notification.ts');
const value: Notice = { operation: 'W03', label: '最大化', shortcut: 'Win + ↑', monitor: bounds, expiresAt: 2000 };

test('破棄した通知の遅延poll応答で新しい通知を消さない', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  t.mock.method(performance, 'now', () => 0);
  const pending = deferred<{ known: boolean; fullscreen: boolean }>();
  let queries = 0;
  const observer = { context: async () => ++queries === 3 ? pending.promise : { known: true, fullscreen: false } };
  const notice = new NotificationWindow(observer, async () => {});
  t.after(() => notice.dismiss());
  assert.equal(await notice.show(value), true);
  t.mock.timers.tick(500);
  assert.equal(queries, 3);
  notice.dismiss();
  assert.equal(await notice.show(value), true);
  const next = FixtureWindow.all.at(-1)!;
  pending.resolve({ known: true, fullscreen: true });
  await pending.promise; await Promise.resolve(); await Promise.resolve();
  assert.equal(next.isDestroyed(), false);
  assert.deepEqual(notice.current(), value);
});

test('停止前の表示要求の遅延失敗で新しい通知を消さない', async (t) => {
  t.mock.method(performance, 'now', () => 0);
  const pending = deferred<{ known: boolean; fullscreen: boolean }>();
  let queries = 0;
  const notice = new NotificationWindow({ context: async () => ++queries === 1 ? pending.promise : { known: true, fullscreen: false } }, async () => {});
  t.after(() => notice.dismiss());
  const old = notice.show(value);
  notice.dismiss();
  assert.equal(await notice.show(value), true);
  const next = FixtureWindow.all.at(-1)!;
  pending.reject(new Error('fixture-old-query-failed'));
  assert.equal(await old, false);
  assert.equal(next.isDestroyed(), false);
  assert.deepEqual(notice.current(), value);
});

for (const context of [{ known: true, fullscreen: true }, { known: false, fullscreen: false }]) {
  test(`全画面または不明な画面を通知しない known=${context.known}`, async (t) => {
    t.mock.method(performance, 'now', () => 0);
    const notice = new NotificationWindow({ context: async () => context }, async () => {});
    t.after(() => notice.dismiss());
    assert.equal(await notice.show(value), false); assert.equal(notice.current(), null);
  });
}

test('通知読込後に全画面化したら表示せず破棄する', async (t) => {
  t.mock.method(performance, 'now', () => 0);
  let queries = 0;
  const notice = new NotificationWindow({ context: async () => ({ known: true, fullscreen: ++queries === 2 }) }, async () => {});
  t.after(() => notice.dismiss());
  assert.equal(await notice.show(value), false);
  assert.equal(FixtureWindow.all.at(-1)!.isDestroyed(), true);
  assert.equal(notice.current(), null);
});

test('通知は負座標の作業領域内でfocusとclickを奪わず4秒で消える', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  t.mock.method(performance, 'now', () => 0);
  const notice = new NotificationWindow({ context: async () => ({ known: true, fullscreen: false }) }, async () => {});
  t.after(() => notice.dismiss());
  assert.equal(await notice.show(value), true);
  const window = FixtureWindow.all.at(-1)!;
  assert.equal(window.options.x, -332); assert.equal(window.options.y, 928);
  assert.equal(window.shown, true); assert.equal(window.ignored, true); assert.equal(notice.focusable(), false);
  assert.equal(window.options.webPreferences?.contextIsolation, true);
  assert.equal(window.options.webPreferences?.nodeIntegration, false);
  assert.equal(window.options.webPreferences?.sandbox, true);
  assert.equal(await notice.show(value), false, '同時に2件表示しない');
  t.mock.timers.tick(3999); assert.equal(window.isDestroyed(), false);
  t.mock.timers.tick(1); assert.equal(window.isDestroyed(), true); assert.equal(notice.current(), null);
});

test('候補の期限一致と照会失敗は通知を見送る', async (t) => {
  t.mock.method(performance, 'now', () => 2000);
  const notice = new NotificationWindow({ context: async () => ({ known: true, fullscreen: false }) }, async () => {});
  t.after(() => notice.dismiss());
  assert.equal(await notice.show(value), false);
  const failing = new NotificationWindow({ context: async () => { throw new Error('fixture-context'); } }, async () => {});
  assert.equal(await failing.show(value), false); assert.equal(failing.current(), null);
});

test('読込中に停止した通知を後から表示しない', async (t) => {
  t.mock.method(performance, 'now', () => 0);
  const loaded = deferred<void>();
  const notice = new NotificationWindow({ context: async () => ({ known: true, fullscreen: false }) }, () => loaded.promise);
  t.after(() => notice.dismiss());
  const showing = notice.show(value);
  await Promise.resolve(); await Promise.resolve();
  notice.dismiss(); loaded.resolve();
  assert.equal(await showing, false); assert.equal(notice.current(), null);
});
