import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { screen, type BrowserWindow } from 'electron';
import type { Coach } from '../core/coach';
import { localDate } from '../core/dates';
import type { Candidate } from '../shared/coach';
import type { ObserverClient } from './observer';
import type { NotificationWindow } from './notification';

type SmokeContext = {
  coach: Coach;
  observer: ObserverClient;
  notice: NotificationWindow;
  window: BrowserWindow;
  getNotificationWindow(): BrowserWindow | null;
  directory: string;
};

export async function runCoachSmoke({ coach, observer, notice, window, getNotificationWindow, directory }: SmokeContext) {
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
  const rendered = await window.webContents.executeJavaScript(`new Promise((resolve) => {
    const timer = setInterval(() => {
      const row = document.querySelector('[data-operation="W03"]');
      if (row?.querySelector('[data-kind="mouse"]')?.textContent === '1' && row?.querySelector('[data-kind="key"]')?.textContent === '1') {
        clearInterval(timer); resolve(true);
      }
    }, 25);
  })`);
  if (!rendered) throw new Error('renderer');
  const notification = getNotificationWindow();
  if (!notification || notification.isDestroyed()) throw new Error('notice-renderer');
  const renderedNotice = await notification.webContents.executeJavaScript(`new Promise((resolve) => {
    const timer = setInterval(() => { if (document.querySelector('.notice strong')?.textContent === 'Win + ↑') { clearInterval(timer); resolve(true); } }, 25);
  })`);
  if (!renderedNotice) throw new Error('notice-content');
  const disk = JSON.parse(await readFile(join(directory, 'counts.json'), 'utf8'));
  if (disk.days[localDate()].W03.mouse !== 1 || Object.keys(disk).join(',') !== 'schemaVersion,days') throw new Error('disk');
  const image = await window.webContents.capturePage();
  await writeFile(join(directory, 'coach-preview.png'), image.toPNG());
  await writeFile(join(directory, 'notice-preview.png'), (await notification.webContents.capturePage()).toPNG());
  await new Promise((resolve) => setTimeout(resolve, 4200));
  if (notice.current() !== null) throw new Error('notice-duration');
  return { mouse: 1, key: 1, duplicateExcluded: true, unknownExcluded: true,
    focusUnchanged: true, autoDismissed: true, fixtureOnly: true,
    realDisplayContext: process.argv.includes('--real-display-smoke') };
}
