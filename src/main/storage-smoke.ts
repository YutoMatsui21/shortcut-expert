import assert from 'node:assert/strict';
import { join } from 'node:path';
import { app, screen, powerMonitor, type BrowserWindow } from 'electron';
import { runLearningSmoke, selectPage, waitForLearning } from './learning-smoke';
import { SqliteRepository } from './sqlite-repository';
import { DurableCoach } from '../core/durable-coach';
import type { Coach } from '../core/coach';
import type { ObserverClient } from './observer';
import { localDate } from '../core/dates';
import { daysBefore } from '../shared/storage';

export async function chooseDay(window: BrowserWindow, day: string): Promise<void> {
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('input[type="date"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(day)});
    input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
}
export async function waitFor(window: BrowserWindow, condition: string, stage: string): Promise<void> {
  await window.webContents.executeJavaScript(`new Promise((resolve,reject)=> {
    const end=Date.now()+3000; const timer=setInterval(()=> {
      if(${condition}) { clearInterval(timer);resolve(true); }
      else if(Date.now()>end) { clearInterval(timer);reject(new Error(${JSON.stringify(stage)})); }
    },25);
  })`);
}

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
  await runLearningSmoke(window);
  const saveSettings = repository.saveSettings.bind(repository);
  repository.saveSettings = async () => { throw new Error('fixture settings failure'); };
  await selectPage(window, 'ショートカット一覧');
  await window.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('[data-learning-operation="W03"] select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'mastered');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitForLearning(window, `document.querySelector('.page-frame .error')?.textContent.includes('設定を保存できません') && document.querySelector('[data-learning-operation="W03"] select')?.value === 'learning'`);
  assert.equal(coach.snapshot().pendingSave, true); assert.equal(coach.snapshot().observing, false);
  repository.saveSettings = saveSettings;
  await window.webContents.executeJavaScript(`document.querySelector('.page-frame .error button').click()`);
  await waitForLearning(window, `!document.querySelector('.page-frame .error') && document.querySelector('[data-learning-operation="W03"] select')?.value === 'mastered'`);
  assert.equal(coach.snapshot().pendingSave, false);
  await window.webContents.executeJavaScript(`window.coach.setLearningState('W03', 'learning')`);
  await window.webContents.executeJavaScript(`window.coach.command('start')`);
  await selectPage(window, '記録');
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
  // Fail only the external Repository query boundary; recovery uses real Main/Worker/Core/React.
  await chooseDay(window, today);
  await waitFor(window, `document.querySelector('[data-operation="W03"] [data-kind="mouse"]')?.textContent==='1'`, 'today-before-query-fault');
  const query = repository.query.bind(repository);
  let failQuery = true;
  repository.query = async (from, to) => {
    if (from === oldDay && failQuery) { failQuery = false; throw new Error('fixture query failure'); }
    return query(from, to);
  };
  await chooseDay(window, oldDay);
  await waitFor(window, `!!document.querySelector('.error')`, 'query-error');
  assert.equal(coach.snapshot().observing, false);
  const revision = coach.snapshot().revision;
  await window.webContents.executeJavaScript(`window.coach.command('start')`);
  await waitFor(window, `!document.querySelector('.error') && document.querySelector('[data-operation="W03"] [data-kind="key"]')?.textContent==='1' &&
    document.querySelector('[data-operation="W03"] [data-kind="mouse"]')?.textContent==='0'`, 'historical-query-recovery');
  assert.equal(coach.snapshot().revision, revision, 'recovery must refetch even with unchanged revision');
  repository.query = query;
  await observer.stop();
  coach.stop(); powerMonitor.emit('suspend'); assert.equal(coach.snapshot().error, null, 'intentional stop stays stopped during sleep');
  await coach.idle(); await repository.close();
  const reopened = new SqliteRepository(app.getPath('userData'), join(__dirname, 'storage-worker.cjs').replace('app.asar', 'app.asar.unpacked'));
  try {
    const fresh = new DurableCoach({ repository: reopened, session: reopened.session, date: localDate, now: () => 0,
      capabilities: () => [], notify: async () => false, changed: () => {} });
    await fresh.initialize(); assert.equal(fresh.snapshot().error, null); assert.equal(fresh.snapshot().counts[today].W03?.key, 1);
    assert.equal((await reopened.query(oldDay, oldDay)).counts[oldDay].W03?.key, 1);
  } finally { await reopened.close(); }
  return { fixtureOnly: true, sqliteWorker: true, renderer: true, mouse: 1, key: 1, oldDayRenderer: true, retained120Days: true,
    reopened: true, boundedIpc: true, historicalQueryRecovered: true, stoppedSuspendPreserved: true, learningStateFailureRecovered: true,
    electron: process.versions.electron, node: process.versions.node, naturalInputVerified: false };
}
