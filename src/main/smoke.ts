import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { app, screen, type BrowserWindow } from 'electron';
import type { Coach } from '../core/coach';
import { localDate } from '../core/dates';
import type { Candidate } from '../shared/coach';
import type { ObserverClient } from './observer';
import type { NotificationWindow } from './notification';
import { JsonRepository } from './repository';
import { Coach as FreshCoach } from '../core/coach';
import { classify } from '../core/detector';
import { operations } from '../shared/coach';
import { runRecordsSmoke } from './records-smoke';
import { runLearningSmoke, selectPage, waitForLearning } from './learning-smoke';

type SmokeContext = {
  coach: Pick<Coach, keyof Coach>;
  observer: ObserverClient;
  notice: NotificationWindow;
  window: BrowserWindow;
  getNotificationWindow(): BrowserWindow | null;
  directory: string;
  chooseDelete(response: number): void;
  verifyWindowExit(): Promise<void>;
};

async function waitRenderer(window: BrowserWindow, condition: string, stage: string): Promise<void> {
  const passed = await window.webContents.executeJavaScript(`new Promise((resolve) => {
    const deadline = Date.now() + 3000;
    const timer = setInterval(() => {
      if (${condition}) { clearInterval(timer); resolve(true); }
      else if (Date.now() >= deadline) { clearInterval(timer); resolve(false); }
    }, 25);
  })`);
  if (!passed) throw new Error(stage);
}

async function click(window: BrowserWindow, label: string): Promise<void> {
  const clicked = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent === ${JSON.stringify(label)});
    if (!button || button.disabled) return false;
    button.click(); return true;
  })()`);
  if (!clicked) throw new Error('ui-button-' + label);
}

export async function runCoachSmoke({ coach, observer, notice, window, getNotificationWindow, directory, chooseDelete, verifyWindowExit }: SmokeContext) {
  if (!coach.snapshot().observing) throw new Error('observer');
  const display = screen.getPrimaryDisplay();
  const physical = screen.dipToScreenRect(null, display.bounds);
  const value: Candidate = { type: 'candidate', protocolVersion: 1, generation: 1, sequence: 1,
    app: 'chrome', operation: 'maximize', date: localDate(), before: { state: 'normal', arranged: false },
    after: { state: 'maximized' }, origin: 'mouse', route: 'max-button', injected: false, conflicted: false,
    moving: false, elevated: false, targetMatched: true, inputAgeMs: 135, monitor: physical };
  const beforeFocus = await observer.focusToken();
  await observer.inject(value); await coach.idle();
  const afterFocus = await observer.focusToken();
  if (beforeFocus !== afterFocus || notice.focusable() || !notice.current()) throw new Error('notice-focus');
  await observer.inject(value);
  await observer.inject({ ...value, sequence: 2, origin: 'key', route: 'win-up' });
  await observer.inject({ ...value, sequence: 3, origin: 'unknown', route: 'unknown' });
  await coach.idle();
  const counts = coach.snapshot().counts[localDate()]?.W03;
  if (counts?.mouse !== 1 || counts.key !== 1) throw new Error('counts');
  await waitForLearning(window, `document.querySelector('nav button[aria-label="ショートカット一覧"]').getAttribute('aria-current') === 'page'`);
  await selectPage(window, '記録');
  await waitRenderer(window, `document.querySelector('[data-operation="W03"] [data-kind="mouse"]')?.textContent === '1' &&
    document.querySelector('[data-operation="W03"] [data-kind="key"]')?.textContent === '1'`, 'renderer');
  const notification = getNotificationWindow();
  if (!notification || notification.isDestroyed()) throw new Error('notice-renderer');
  await waitRenderer(notification, `document.querySelector('.notice strong')?.textContent === 'Win + ↑'`, 'notice-content');
  const forbiddenSender = await notification.webContents.executeJavaScript(`window.coach.getSnapshot().then(() => false, () => true)`);
  if (!forbiddenSender) throw new Error('ipc-notice-sender');
  const rejected = await window.webContents.executeJavaScript(`Promise.all([
    window.coach.command('unknown'), window.coach.setMuted('W99', true), window.coach.setMuted('W03', 'true'), window.coach.getNotice(),
    window.coach.setLearningState('W09', 'learning'), window.coach.setLearningState('W03', 'automatic')
  ].map((request) => request.then(() => false, () => true)))`);
  if (!rejected.every((value: boolean) => value)) throw new Error('ipc-invalid-payload');
  const isolated = await window.webContents.executeJavaScript(`typeof require === 'undefined' && typeof process === 'undefined' &&
    Object.keys(window.coach).sort().join(',') === 'command,deleteCounts,getLearning,getNotice,getRecordSummary,getRecords,getSnapshot,setLearningState,setMuted,subscribe,windowCommand'`);
  if (!isolated) throw new Error('renderer-capabilities');
  const disk = JSON.parse(await readFile(join(directory, 'counts.json'), 'utf8'));
  if (disk.days[localDate()].W03.mouse !== 1 || Object.keys(disk).join(',') !== 'schemaVersion,days') throw new Error('disk');
  const image = await window.webContents.capturePage();
  await writeFile(join(directory, 'coach-preview.png'), image.toPNG());
  await writeFile(join(directory, 'notice-preview.png'), (await notification.webContents.capturePage()).toPNG());
  await new Promise((resolve) => setTimeout(resolve, 4200));
  if (notice.current() !== null) throw new Error('notice-duration');
  await runLearningSmoke(window);
  await runRecordsSmoke(window);
  await window.webContents.executeJavaScript('document.querySelector(".gear-button").click()');

  await click(window, '通知を停止');
  await waitRenderer(window, `document.querySelector('.settings-popover')?.textContent.includes('通知を再開')`, 'ui-notification-pause');
  await observer.inject({ ...value, sequence: 4, origin: 'key', route: 'win-up' }); await coach.idle();
  if (coach.snapshot().counts[localDate()].W03?.key !== 2 || notice.current()) throw new Error('paused-counting');
  const additions: { candidate: Candidate; key: string }[] = [
    { candidate: { ...value, operation: 'minimize', after: { state: 'minimized' }, route: 'min-button' }, key: 'win-down' },
    { candidate: { ...value, operation: 'restore', before: { state: 'maximized', arranged: false },
      after: { state: 'normal' }, afterArranged: false }, key: 'win-down' },
    { candidate: { ...value, operation: 'close', after: { state: 'closed' }, route: 'close-button' }, key: 'alt-f4' },
    { candidate: { ...value, operation: 'monitor-move', after: { state: 'normal' }, route: 'caption-drag', fromMonitor: physical,
      toMonitor: { ...physical, x: physical.x + physical.width }, moveDirection: 'right' }, key: 'win-shift-right' }
  ];
  let addedSequence = 4;
  for (const entry of additions) {
    await observer.inject({ ...entry.candidate, sequence: ++addedSequence });
    await observer.inject({ ...entry.candidate, sequence: ++addedSequence, origin: 'key', route: entry.key });
    await coach.idle();
    const result = classify(entry.candidate);
    if (!result?.shortcut || notice.current()) throw new Error('added-classification');
    await waitRenderer(window, `document.querySelector('[data-operation="${result.operation}"] [data-kind="mouse"]')?.textContent === '1' &&
      document.querySelector('[data-operation="${result.operation}"] [data-kind="key"]')?.textContent === '1'`, 'added-renderer');
    const saved = await new JsonRepository(directory).load();
    if (saved.counts[localDate()][result.operation]?.key !== 1) throw new Error('added-save');
    // Fixture notices separately exercise the real display path while the product's cooldown remains intact.
    const label = operations.find((op) => op.id === result.operation)!.label;
    const focus = await observer.focusToken();
    if (!await notice.show({ operation: result.operation, label, shortcut: result.shortcut, monitor: physical,
      expiresAt: performance.now() + 2000 })) throw new Error('added-notice');
    const addedWindow = getNotificationWindow();
    if (!addedWindow) throw new Error('added-notice-window');
    await waitRenderer(addedWindow, `document.querySelector('.notice strong')?.textContent === ${JSON.stringify(result.shortcut)} &&
      document.querySelector('.notice-label')?.textContent === ${JSON.stringify(label)}`, 'added-notice-content');
    if (await observer.focusToken() !== focus || notice.focusable()) throw new Error('added-notice-focus');
    notice.dismiss();
  }
  await click(window, '計測を全停止');
  await waitRenderer(window, `document.querySelector('.settings-popover')?.textContent.includes('計測を再開')`, 'ui-stop');
  await observer.inject({ ...value, sequence: ++addedSequence }); await coach.idle();
  if (coach.snapshot().counts[localDate()].W03?.mouse !== 1) throw new Error('stop-counting');
  await click(window, '計測を再開');
  await waitRenderer(window, `document.querySelector('.settings-popover')?.textContent.includes('通知を再開')`, 'ui-start');
  await click(window, '通知を再開');
  await waitRenderer(window, `document.querySelector('.settings-popover')?.textContent.includes('通知を停止')`, 'ui-notification-resume');
  await window.webContents.executeJavaScript(`window.coach.setLearningState('W03', 'excluded')`);
  await window.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('.records-page select[aria-label="集計対象"]');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'all');
    select.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  const reload = await new JsonRepository(directory).load();
  if (reload.settings.muted.join() !== 'W03' || reload.counts[localDate()].W03?.key !== 2) throw new Error('settings-reload');
  const restarted = new FreshCoach({ repository: new JsonRepository(directory), date: localDate, now: () => 0,
    notify: async () => false, changed: () => {} });
  await restarted.initialize();
  if (restarted.snapshot().notificationsPaused || restarted.snapshot().settings.muted.join() !== 'W03') throw new Error('restart-state');
  const previous = new Date(); previous.setDate(previous.getDate() - 1);
  const previousDate = localDate(previous);
  await observer.inject({ ...value, generation: 2, sequence: 1, date: previousDate, origin: 'key', route: 'win-up' });
  await coach.idle();
  await waitRenderer(window, `document.querySelector('[data-operation="W03"] [data-kind="key"]')?.textContent === '3'`, 'seven-day-total');
  chooseDelete(0); await click(window, 'すべての記録を削除…');
  await waitRenderer(window, `[...document.querySelectorAll('.settings-popover button')].some(button => button.textContent === 'すべての記録を削除…' && !button.disabled)`, 'delete-cancel-settled');
  if (!coach.snapshot().counts[previousDate]) throw new Error('delete-cancel');
  chooseDelete(1); await click(window, 'すべての記録を削除…');
  await waitRenderer(window, `document.querySelector('[data-operation="W03"] [data-kind="key"]')?.textContent === '—'`, 'ui-delete-confirm');
  const cleared = await new JsonRepository(directory).load();
  if (Object.keys(cleared.counts).length || cleared.settings.muted.join() !== 'W03') throw new Error('delete-settings-retained');
  await observer.inject({ ...value, generation: 2, sequence: 2 }); await coach.idle();
  if (Object.keys(coach.snapshot().counts).length) throw new Error('delete-old-generation');

  window.show(); window.close();
  if (window.isDestroyed() || window.isVisible() || !coach.snapshot().observing) throw new Error('window-close-hide');
  // Use the registered second-instance listener, which shares the tray's show entry point.
  app.emit('second-instance', {}, [], '');
  if (!window.isVisible() || window.isDestroyed()) throw new Error('window-redisplay');
  await new Promise<void>((resolve) => { window.once('minimize', () => resolve()); window.minimize(); });
  const restored = new Promise<void>((resolve) => window.once('restore', () => resolve()));
  app.emit('second-instance', {}, [], '');
  await restored;
  if (window.isMinimized() || !window.isVisible()) throw new Error('window-restore');
  const loaded = new Promise<void>((resolve) => window.webContents.once('did-finish-load', () => resolve()));
  window.webContents.reload(); await loaded;
  await waitForLearning(window, `document.querySelector('nav button[aria-label="ショートカット一覧"]').getAttribute('aria-current') === 'page' && [...document.querySelectorAll('.group-header')].every(button => button.getAttribute('aria-expanded') === 'true')`);
  await selectPage(window, '記録');
  await window.webContents.executeJavaScript('document.querySelector(".gear-button").click()');
  if (!coach.snapshot().settings.muted.includes('W03')) throw new Error('ui-reload-snapshot');
  await click(window, '通知を停止');
  await waitRenderer(window, `document.querySelector('.settings-popover')?.textContent.includes('通知を再開')`, 'ui-reload-command');
  await click(window, '通知を再開');
  await waitRenderer(window, `document.querySelector('.settings-popover')?.textContent.includes('通知を停止')`, 'ui-reload-subscription');
  const caption = await window.webContents.executeJavaScript(`({
    drag: getComputedStyle(document.querySelector('.titlebar')).getPropertyValue('-webkit-app-region'),
    controls: getComputedStyle(document.querySelector('.window-controls')).getPropertyValue('-webkit-app-region')
  })`);
  if (caption.drag !== 'drag' || caption.controls !== 'no-drag') throw new Error('caption-regions');
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="最大化"]').click()`);
  await waitRenderer(window, `!!document.querySelector('button[aria-label="復元"]')`, 'caption-maximized');
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="復元"]').click()`);
  await waitRenderer(window, `!!document.querySelector('button[aria-label="最大化"]')`, 'caption-restored');
  const restoredBounds = window.getNormalBounds();
  const windowEvidence = { bounds: window.getBounds(), content: window.getContentBounds(),
    viewport: await window.webContents.executeJavaScript('({width:innerWidth,height:innerHeight,devicePixelRatio})'),
    scaleFactor: screen.getDisplayMatching(restoredBounds).scaleFactor };
  await verifyWindowExit();
  return { mouse: 1, key: 1, duplicateExcluded: true, unknownExcluded: true,
    focusUnchanged: true, autoDismissed: true, fixtureOnly: true,
    uiControls: true, operationShortcuts: 12, addedOperations: 4, addedNoticeWindows: true,
    deleteCancelledAndConfirmed: true, settingsReloaded: true, ipcRejected: true, isolatedRenderer: true,
    windowHiddenAndRestored: true, rendererResubscribed: true, captionCommands: true,
    pendingExitCancelledAndRecovered: true, windowEvidence,
    realDisplayContext: process.argv.includes('--real-display-smoke') };
}
