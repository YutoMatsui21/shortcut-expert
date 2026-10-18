import assert from 'node:assert/strict';
import { join } from 'node:path';
import { app, screen, type BrowserWindow } from 'electron';
import { SqliteRepository } from './sqlite-repository';
import { DurableCoach } from '../core/durable-coach';
import type { Coach } from '../core/coach';
import type { ObserverClient } from './observer';
import { localDate } from '../core/dates';
import { daysBefore } from '../shared/storage';

export async function runStorageSmoke({ coach, observer, window, repository }: {
  coach: Pick<Coach, keyof Coach>; observer: ObserverClient; window: BrowserWindow; repository: unknown;
}) {
  assert.ok(repository instanceof SqliteRepository);
  assert.equal(coach.snapshot().observing, true);
  const today = localDate();
  const sample = { type: 'candidate' as const, protocolVersion: 1 as const, generation: 1, sequence: 1, app: 'chrome', operation: 'maximize', date: today,
    before: { state: 'normal', arranged: false }, after: { state: 'maximized' }, origin: 'key', route: 'win-up', injected: false,
    conflicted: false, moving: false, elevated: false, targetMatched: true, inputAgeMs: 100, monitor: screen.getPrimaryDisplay().bounds } satisfies import('../shared/coach').Candidate;
  coach.pauseNotifications(true);
  await observer.inject(sample);
  await observer.inject({ ...sample, sequence: 2, origin: 'mouse', route: 'max-button' });
  const oldDay = daysBefore(today, 120);
  await observer.inject({ ...sample, sequence: 3, date: oldDay });
  await coach.idle();
  assert.equal(coach.snapshot().counts[today].W03?.key, 1);
  assert.equal(coach.snapshot().counts[today].W03?.mouse, 1);
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const end = Date.now() + 3000; const timer = setInterval(() => {
      if(document.querySelector('[data-operation="W03"] [data-kind="key"]')?.textContent === '1') { clearInterval(timer); resolve(true); }
      else if(Date.now()>end) { clearInterval(timer); reject(new Error('renderer')); }
    },25);
  })`);
  const invalid = await window.webContents.executeJavaScript(`window.coach.getRecords('2020-01-01','2026-10-19').then(()=>false,()=>true)`);
  assert.equal(invalid, true);
  const older = await window.webContents.executeJavaScript(`window.coach.getRecords('${oldDay}','${oldDay}')`);
  assert.equal(older.counts[oldDay].W03.key, 1);
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('input[type="date"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'${oldDay}');
    input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await window.webContents.executeJavaScript(`new Promise((resolve,reject)=> {
    const end=Date.now()+3000; const timer=setInterval(()=> {
      if(document.querySelector('[data-operation="W03"] [data-kind="key"]')?.textContent==='1' &&
        document.querySelector('[data-operation="W03"] [data-kind="mouse"]')?.textContent==='0') {clearInterval(timer);resolve(true);}
      else if(Date.now()>end) {clearInterval(timer);reject(new Error('old-day-renderer'));}
    },25);
  })`);
  await observer.stop();
  coach.stop(); await coach.idle(); await repository.close();
  const reopened = new SqliteRepository(app.getPath('userData'), join(__dirname, 'storage-worker.cjs').replace('app.asar', 'app.asar.unpacked'));
  try {
    const fresh = new DurableCoach({ repository: reopened, session: reopened.session, date: localDate, now: () => 0,
      capabilities: () => [], notify: async () => false, changed: () => {} });
    await fresh.initialize(); assert.equal(fresh.snapshot().error, null); assert.equal(fresh.snapshot().counts[today].W03?.key, 1);
    assert.equal((await reopened.query(oldDay, oldDay)).counts[oldDay].W03?.key, 1);
  } finally { await reopened.close(); }
  return { fixtureOnly: true, sqliteWorker: true, renderer: true, mouse: 1, key: 1, oldDayRenderer: true, retained120Days: true,
    reopened: true, boundedIpc: true, electron: process.versions.electron, node: process.versions.node, naturalInputVerified: false };
}
