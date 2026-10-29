import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { app, screen, powerMonitor, type BrowserWindow } from 'electron';
import { runLearningSmoke, selectPage, waitForLearning } from './learning-smoke';
import { runRecordsSmoke } from './records-smoke';
import { SqliteRepository } from './sqlite-repository';
import { DurableCoach } from '../core/durable-coach';
import type { Coach } from '../core/coach';
import type { ObserverClient } from './observer';
import { localDate } from '../core/dates';
import { daysBefore } from '../shared/storage';

export async function waitFor(window: BrowserWindow, condition: string, stage: string): Promise<void> {
  await window.webContents.executeJavaScript(`new Promise((resolve,reject)=> {
    const end=Date.now()+3000; const timer=setInterval(()=> {
      if(${condition}) { clearInterval(timer);resolve(true); }
      else if(Date.now()>end) { clearInterval(timer);reject(new Error(${JSON.stringify(stage)})); }
    },25);
  })`);
}

export async function runStorageSmoke({ coach, observer, window, repository, workerPath, verifyPendingExit, verifyNotifications }: {
  coach: Pick<Coach, keyof Coach>; observer: ObserverClient; window: BrowserWindow; repository: unknown;
  workerPath: string;
  verifyPendingExit?: () => Promise<void>;
  verifyNotifications?: (sample: import('../shared/coach').Candidate) => Promise<void>;
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
  await waitForLearning(window, `document.querySelector('.page-header + .save-error-banner')?.textContent.includes('設定を保存できません') && document.querySelector('[data-learning-operation="W03"] select')?.value === 'learning'`);
  assert.equal(coach.snapshot().pendingSave, true); assert.equal(coach.snapshot().observing, false);
  const layouts = [];
  for (const width of [800, 920, 1120, 1360]) {
    window.setContentSize(width, 600);
    await waitFor(window, `Math.abs(innerWidth - ${width}) <= 1`, 'save-error-width');
    const actual = await window.webContents.executeJavaScript('innerWidth');
    if (actual !== width) window.setSize(window.getSize()[0] + width - actual, window.getSize()[1]);
    await waitFor(window, `innerWidth === ${width}`, 'save-error-exact-width');
    for (const [page, frame] of [['ショートカット一覧', '.page-frame'], ['記録', '.records-page']] as const) {
      await selectPage(window, page);
      const result = await window.webContents.executeJavaScript(`(() => {
        const frame = document.querySelector('${frame}');
        const header = frame.querySelector('header').getBoundingClientRect();
        const banner = frame.querySelector('.save-error-banner'); const box = banner.getBoundingClientRect();
        const scroll = frame.querySelector('main'); const body = scroll.getBoundingClientRect();
        const button = banner.querySelector('button').getBoundingClientRect();
        const icon = banner.querySelector('img'); const iconBox = icon.getBoundingClientRect();
        scroll.scrollTop = 200;
        return {width:innerWidth,page:'${page}',height:box.height,headerGap:box.top-header.bottom,
          bodyGap:body.top-box.bottom,fixed:banner.getBoundingClientRect().top === box.top,
          buttonInside:button.right <= box.right && button.left >= box.left && button.bottom <= box.bottom,
          buttonWidth:button.width,buttonHeight:button.height,iconWidth:iconBox.width,iconHeight:iconBox.height,
          iconLoaded:icon.complete && icon.naturalWidth > 0,alert:banner.getAttribute('role'),
          noOverflow:document.documentElement.scrollWidth === innerWidth};
      })()`);
      assert.equal(result.height, 52); assert.equal(result.headerGap, 0); assert.equal(result.bodyGap, 0);
      assert.equal(result.fixed, true); assert.equal(result.buttonInside, true); assert.equal(result.noOverflow, true);
      assert.equal(result.buttonWidth, 92); assert.equal(result.buttonHeight, 32);
      assert.equal(result.iconWidth, 18); assert.equal(result.iconHeight, 18); assert.equal(result.iconLoaded, true);
      assert.equal(result.alert, 'alert'); layouts.push(result);
      await writeFile(join(app.getPath('userData'), `save-error-${width}-${frame === '.page-frame' ? 'learning' : 'records'}.png`), (await window.webContents.capturePage()).toPNG());
    }
  }
  await writeFile(join(app.getPath('userData'), 'save-error-layout.json'), JSON.stringify(layouts));
  await selectPage(window, 'ショートカット一覧');
  await window.webContents.executeJavaScript(`window.coach.command('start')`);
  assert.equal(coach.snapshot().observing, false, 'start must not discard a pending settings write');
  repository.saveSettings = saveSettings;
  await window.webContents.executeJavaScript(`document.querySelector('.page-header + .save-error-banner button').click()`);
  await waitForLearning(window, `!document.querySelector('.save-error-banner') && document.querySelector('[data-learning-operation="W03"] select')?.value === 'mastered'`);
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
  await runRecordsSmoke(window);
  // Isolated placement transport -> strict Main parse -> SQLite -> actual renderer/IPC.
  await observer.stop(); coach.stop();
  const placementGeneration = await observer.start(); coach.begin(placementGeneration);
  for (const [offset, operation, shape] of [[0, 'W06', 'left-half'], [2, 'W07', 'right-bottom']] as const) {
    for (const [index, origin] of ['mouse', 'key'].entries()) {
      const id = 1000 + offset + index;
      const value: import('../shared/coach').CandidateV2 = { type: 'candidate', protocolVersion: 2, generation: placementGeneration,
        sequence: id, transaction: id, date: today, origin: origin as 'mouse' | 'key',
        route: origin === 'mouse' ? 'caption-edge-drag' : 'win-held-arrows', injected: false, conflicted: false,
        evidence: { kind: 'placement', profile: 'placement-v1', shape, targetMatched: true, inputAgeMs: 100,
          monitorChanged: false, monitor: sample.monitor } };
      await observer.inject(value); await observer.inject(value); await coach.idle();
    }
    const saved = await repository.query(today, today);
    assert.deepEqual(saved.counts[today][operation], { mouse: 1, key: 1 });
    await waitFor(window, `document.querySelector('[data-operation="${operation}"] [data-kind="mouse"]')?.textContent === '1' &&
      document.querySelector('[data-operation="${operation}"] [data-kind="key"]')?.textContent === '1'`, 'placement-records');
    await selectPage(window, 'ショートカット一覧');
    await waitForLearning(window, `document.querySelector('[data-learning-operation="${operation}"] select')?.value === 'learning'`);
    await selectPage(window, '記録');
  }
  // W11's typed production evidence reaches both real pages through Main/IPC/SQLite.
  for (const [index, origin] of ['mouse', 'key'].entries()) {
    const id = 1100 + index;
    const value: import('../shared/coach').CandidateV2 = { type: 'candidate', protocolVersion: 2, generation: placementGeneration,
      sequence: id, transaction: id, date: today, origin: origin === 'mouse' ? 'mouse' : 'key',
      route: origin === 'mouse' ? 'close-button' : 'alt-f4', injected: false, conflicted: false,
      evidence: { kind: 'window-close', profile: 'window-close-v1', targetMatched: true, destroyed: true,
        inputAgeMs: 200, monitor: sample.monitor } };
    await observer.inject(value); await observer.inject(value); await coach.idle();
  }
  assert.deepEqual((await repository.query(today, today)).counts[today].W11, { mouse: 1, key: 1 });
  await waitFor(window, `document.querySelector('[data-operation="W11"] [data-kind="mouse"]')?.textContent === '1' &&
    document.querySelector('[data-operation="W11"] [data-kind="key"]')?.textContent === '1'`, 'close-records');
  await selectPage(window, 'ショートカット一覧');
  await waitForLearning(window, `document.querySelector('[data-learning-operation="W11"] select')?.value === 'learning'`);
  await selectPage(window, '記録');
  const query = repository.query.bind(repository);
  let failQuery = true;
  repository.query = async (from, to) => {
    if (from === daysBefore(today, 13) && failQuery) { failQuery = false; throw new Error('fixture query failure'); }
    return query(from, to);
  };
  await window.webContents.executeJavaScript(`window.coach.getRecordSummary().catch(() => {})`);
  await waitFor(window, `document.querySelector('.records-header + .save-error-banner')?.dataset.errorKind === 'storage'`, 'query-error');
  assert.equal(coach.snapshot().observing, false);
  const revision = coach.snapshot().revision;
  await window.webContents.executeJavaScript(`document.querySelector('.records-header + .save-error-banner button').click()`);
  await waitFor(window, `!document.querySelector('.save-error-banner') && document.querySelector('[data-operation="W03"] [data-kind="key"]')?.textContent==='1' &&
    document.querySelector('[data-operation="W03"] [data-kind="mouse"]')?.textContent==='1'`, 'historical-query-recovery');
  assert.equal(coach.snapshot().revision, revision, 'recovery must refetch even with unchanged revision');
  assert.equal(coach.snapshot().observing, false, 'storage recovery must not resume the observer');
  await window.webContents.executeJavaScript(`window.coach.command('start')`);
  repository.query = query;
  coach.fault('fixture independent observer fault');
  repository.query = async () => { throw new Error('fixture concurrent read failure'); };
  await window.webContents.executeJavaScript(`window.coach.getRecordSummary().catch(() => {})`);
  assert.equal(coach.snapshot().canRetrySave, true, 'an existing observer fault must not hide a new storage failure');
  await waitFor(window, `document.querySelectorAll('.record-table tbody tr').length === 0 && document.querySelector('.records-scroll')?.getAttribute('aria-busy') === 'false'`, 'masked-read-error');
  repository.query = query;
  await window.webContents.executeJavaScript(`window.coach.command('retry-save')`);
  assert.equal(coach.snapshot().error, 'fixture independent observer fault');
  assert.equal(coach.snapshot().observing, false);
  await waitFor(window, `document.querySelector('[data-operation="W03"] [data-kind="key"]')?.textContent === '1' && document.querySelector('[data-operation="W03"] [data-kind="mouse"]')?.textContent === '1'`, 'masked-read-recovery-rows');
  await window.webContents.executeJavaScript(`window.coach.command('start')`);
  await verifyPendingExit?.();
  await verifyNotifications?.(sample);
  await observer.stop();
  coach.stop(); powerMonitor.emit('suspend'); assert.equal(coach.snapshot().error, null, 'intentional stop stays stopped during sleep');
  await coach.idle(); await repository.close();
  const reopened = new SqliteRepository(app.getPath('userData'), workerPath);
  try {
    const fresh = new DurableCoach({ repository: reopened, session: reopened.session, date: localDate, now: () => 0,
      capabilities: () => [], notify: async () => false, changed: () => {} });
    await fresh.initialize(); assert.equal(fresh.snapshot().error, null); assert.equal(fresh.snapshot().counts[today].W03?.key, 1);
    assert.equal((await reopened.query(oldDay, oldDay)).counts[oldDay].W03?.key, 1);
  } finally { await reopened.close(); }
  return { fixtureOnly: true, sqliteWorker: true, renderer: true, mouse: verifyNotifications ? 4 : 1, key: 1, sevenDayRenderer: true, retained120Days: true,
    standardToastRequests: verifyNotifications ? 3 : 0, osToastDisplayVerified: false,
    reopened: true, boundedIpc: true, placementRecords: true, summaryQueryRecovered: true, stoppedSuspendPreserved: true, learningStateFailureRecovered: true,
    saveErrorWidths: [800, 920, 1120, 1360], pendingStartBlocked: true, pendingExitRecovered: !!verifyPendingExit,
    electron: process.versions.electron, node: process.versions.node, naturalInputVerified: false };
}
