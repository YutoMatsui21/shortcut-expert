import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { screen, type BrowserWindow } from 'electron';
import type { Coach } from '../core/coach';
import { localDate } from '../core/dates';
import type { Candidate } from '../shared/coach';
import type { ObserverClient } from './observer';
import type { NotificationWindow } from './notification';
import { JsonRepository } from './repository';
import { Coach as FreshCoach } from '../core/coach';

type SmokeContext = {
  coach: Coach;
  observer: ObserverClient;
  notice: NotificationWindow;
  window: BrowserWindow;
  getNotificationWindow(): BrowserWindow | null;
  directory: string;
  chooseDelete(response: number): void;
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

export async function runCoachSmoke({ coach, observer, notice, window, getNotificationWindow, directory, chooseDelete }: SmokeContext) {
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
  await waitRenderer(window, `document.querySelector('[data-operation="W03"] [data-kind="mouse"]')?.textContent === '1' &&
    document.querySelector('[data-operation="W03"] [data-kind="key"]')?.textContent === '1'`, 'renderer');
  const notification = getNotificationWindow();
  if (!notification || notification.isDestroyed()) throw new Error('notice-renderer');
  await waitRenderer(notification, `document.querySelector('.notice strong')?.textContent === 'Win + ↑'`, 'notice-content');
  const forbiddenSender = await notification.webContents.executeJavaScript(`window.coach.getSnapshot().then(() => false, () => true)`);
  if (!forbiddenSender) throw new Error('ipc-notice-sender');
  const rejected = await window.webContents.executeJavaScript(`Promise.all([
    window.coach.command('unknown'), window.coach.setMuted('W99', true), window.coach.setMuted('W03', 'true'), window.coach.getNotice()
  ].map((request) => request.then(() => false, () => true)))`);
  if (!rejected.every((value: boolean) => value)) throw new Error('ipc-invalid-payload');
  const isolated = await window.webContents.executeJavaScript(`typeof require === 'undefined' && typeof process === 'undefined' &&
    Object.keys(window.coach).sort().join(',') === 'command,deleteCounts,getNotice,getSnapshot,setMuted,subscribe'`);
  if (!isolated) throw new Error('renderer-capabilities');
  const disk = JSON.parse(await readFile(join(directory, 'counts.json'), 'utf8'));
  if (disk.days[localDate()].W03.mouse !== 1 || Object.keys(disk).join(',') !== 'schemaVersion,days') throw new Error('disk');
  const image = await window.webContents.capturePage();
  await writeFile(join(directory, 'coach-preview.png'), image.toPNG());
  await writeFile(join(directory, 'notice-preview.png'), (await notification.webContents.capturePage()).toPNG());
  await new Promise((resolve) => setTimeout(resolve, 4200));
  if (notice.current() !== null) throw new Error('notice-duration');

  await click(window, '通知を停止');
  await waitRenderer(window, `document.querySelector('.badge')?.textContent === '記録中 · 通知停止'`, 'ui-notification-pause');
  await observer.inject({ ...value, sequence: 4, origin: 'key', route: 'win-up' }); await coach.idle();
  if (coach.snapshot().counts[localDate()].W03?.key !== 2 || notice.current()) throw new Error('paused-counting');
  await click(window, '計測を全停止');
  await waitRenderer(window, `document.querySelector('.badge')?.textContent === '全停止'`, 'ui-stop');
  await observer.inject({ ...value, sequence: 5 }); await coach.idle();
  if (coach.snapshot().counts[localDate()].W03?.mouse !== 1) throw new Error('stop-counting');
  await click(window, '計測を再開');
  await waitRenderer(window, `document.querySelector('.badge')?.textContent === '記録中 · 通知停止'`, 'ui-start');
  await click(window, '通知を再開');
  await waitRenderer(window, `document.querySelector('.badge')?.textContent === '記録中'`, 'ui-notification-resume');
  await window.webContents.executeJavaScript(`document.querySelector('input[aria-label="最大化の通知"]').click()`);
  await waitRenderer(window, `document.querySelector('input[aria-label="最大化の通知"]')?.checked === false &&
    [...document.querySelectorAll('button')].some((button) => button.textContent === '全日分の記録を削除' && !button.disabled)`, 'ui-mute');
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
  await waitRenderer(window, `!![...document.querySelectorAll('select option')].find((option) => option.value === ${JSON.stringify(previousDate)})`, 'ui-day-option');
  await window.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('select'); select.value = ${JSON.stringify(previousDate)}; select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitRenderer(window, `document.querySelector('[data-operation="W03"] [data-kind="mouse"]')?.textContent === '0' &&
    document.querySelector('[data-operation="W03"] [data-kind="key"]')?.textContent === '1'`, 'ui-past-day');
  chooseDelete(0); await click(window, '全日分の記録を削除');
  await waitRenderer(window, `[...document.querySelectorAll('button')].some((button) => button.textContent === '全日分の記録を削除' && !button.disabled)`, 'ui-delete-cancel');
  if (!coach.snapshot().counts[previousDate]) throw new Error('delete-cancel');
  chooseDelete(1); await click(window, '全日分の記録を削除');
  await waitRenderer(window, `document.querySelector('[data-operation="W03"] [data-kind="key"]')?.textContent === '0' &&
    document.querySelector('select')?.options.length === 1 && document.querySelector('.badge')?.textContent === '記録中'`, 'ui-delete-confirm');
  const cleared = await new JsonRepository(directory).load();
  if (Object.keys(cleared.counts).length || cleared.settings.muted.join() !== 'W03') throw new Error('delete-settings-retained');
  await observer.inject({ ...value, generation: 2, sequence: 2 }); await coach.idle();
  if (Object.keys(coach.snapshot().counts).length) throw new Error('delete-old-generation');
  return { mouse: 1, key: 1, duplicateExcluded: true, unknownExcluded: true,
    focusUnchanged: true, autoDismissed: true, fixtureOnly: true,
    uiControls: true, deleteCancelledAndConfirmed: true, settingsReloaded: true, ipcRejected: true, isolatedRenderer: true,
    realDisplayContext: process.argv.includes('--real-display-smoke') };
}
