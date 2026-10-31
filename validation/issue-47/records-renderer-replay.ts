// Fixture-only replay of approved daily totals through the unchanged packaged renderer/preload.
// No native helper, real input observation, screenshot, original DB write or product repackaging.
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { registerCoachIpc } from '../../src/main/coach-ipc.ts';
import { recordsReadModel } from '../../src/core/records.ts';
import { learningReadModel } from '../../src/core/learning.ts';
import { localDate } from '../../src/core/dates.ts';
import { selectPage, waitForLearning } from '../../src/main/learning-smoke.ts';
import type { Counts, Settings, Snapshot } from '../../src/shared/coach.ts';

const workspace = resolve('.');
const root = resolve(process.env.COACH_E47_REPLAY_ROOT ?? '');
assert.ok(root.startsWith(join(workspace, '.tools', 'validation') + sep), 'Isolated fixture root required');
const packageRoot = resolve(process.env.COACH_E47_PACKAGE_ROOT ?? '');
assert.equal(packageRoot, join(workspace, 'release', 'issue-47-top-threshold', 'win-unpacked'));
mkdirSync(root, { recursive: true }); app.setPath('userData', root);
const bytes = readFileSync(join(workspace, 'validation/evidence/issue-47/session26-totals.json'));
const input = JSON.parse(bytes.toString('utf8'));
assert.equal(input.readOnly, true); assert.equal(input.rows.length, 8);
const expected = new Map<string, {mouse:number;key:number}>();
for (const row of input.rows) {
  assert.ok(/^W(01|02|03|04|06|07|11|12)$/.test(row.operation));
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(row.day));
  assert.ok(Number.isSafeInteger(row.mouse) && row.mouse >= 0 && Number.isSafeInteger(row.key) && row.key >= 0);
  assert.ok(!expected.has(row.operation)); expected.set(row.operation, {mouse:row.mouse,key:row.key});
}
const today = localDate();
const counts: Counts = { [today]: Object.fromEntries(expected) };
const settings: Settings = { opened:true, muted:[] };
const records = { counts, coverage:{}, revision:1 };
const snapshot: Snapshot = { counts, settings, revision:1, stateVersion:1, observing:false, notificationsPaused:false, error:null, pendingSave:false };
const rejectMutation = async (): Promise<never> => { throw new Error('Read-only renderer fixture'); };
let stage = 'startup';
const timer = setTimeout(() => { console.log('RECORDS_REPLAY_TIMEOUT'); app.exit(1); }, 25_000);
void app.whenReady().then(async () => {
  const window = new BrowserWindow({show:false,width:1120,height:700,frame:false,autoHideMenuBar:true,
    webPreferences:{preload:join(packageRoot,'resources/app.asar/out/preload/index.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false} });
  window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  window.webContents.on('will-navigate', e => e.preventDefault());
  registerCoachIpc(() => window, {
    getSnapshot: async () => snapshot,
    getLearning: async () => learningReadModel(records,settings,today),
    getRecordSummary: async query => recordsReadModel(records,settings,today,query),
    getRecords: async () => records,
    command:rejectMutation,setLearningState:rejectMutation,deleteCounts:rejectMutation,windowCommand:rejectMutation
  });
  stage = 'load-renderer';
  await window.loadFile(join(packageRoot,'resources/app.asar/out/renderer/index.html'),{query:{mode:'coach'}});
  await waitForLearning(window,"document.querySelectorAll('[data-learning-operation]').length === 8");
  stage = 'verify-list';
  const list = await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-learning-operation]')).map(e=>({id:e.dataset.learningOperation,rate:e.querySelector('.key-rate').textContent.trim()}))`);
  assert.equal(list.length,8);
  for(const row of list) {
    const value=expected.get(row.id)!; assert.ok(value);
    assert.ok(row.rate.includes((100*value.key/(value.mouse+value.key)).toFixed(1)+'%'));
    assert.ok(row.rate.includes(value.key+'/'+(value.mouse+value.key)));
  }
  stage = 'open-records';
  await selectPage(window,'記録');
  await waitForLearning(window,"document.querySelector('.records-scroll')?.getAttribute('aria-busy') === 'false' && document.querySelectorAll('.record-table tbody tr').length === 8");
  stage = 'verify-records';
  const rendered = await window.webContents.executeJavaScript(`({summary:Object.fromEntries(['rate','key','mouse'].map(k=>[k,document.querySelector('[data-kpi="'+k+'"]').textContent.trim()])),rows:Array.from(document.querySelectorAll('.record-table tbody tr')).map(e=>({id:e.dataset.operation,label:e.querySelector('th span').textContent.trim(),mouse:Number(e.querySelector('[data-kind="mouse"]').textContent),key:Number(e.querySelector('[data-kind="key"]').textContent),fraction:e.querySelector('.record-fraction').textContent.trim(),rate:e.querySelector('.record-rate > span:not(.compact-rate-label)').textContent.trim()}))})`);
  writeFileSync(join(root,'partial.json'),JSON.stringify({rendered},null,2));
  assert.deepEqual(rendered.summary,{rate:'40.0%',key:'8回',mouse:'12回'});
  assert.equal(rendered.rows.length,8);
  for(const row of rendered.rows) {
    const value=expected.get(row.id)!; assert.ok(value);
    assert.equal(row.mouse,value.mouse);assert.equal(row.key,value.key);
    assert.equal(row.fraction,'（'+value.key+'/'+(value.mouse+value.key)+'）');
    assert.equal(row.rate,(100*value.key/(value.mouse+value.key)).toFixed(1)+'%');
  }
  const report={fixtureOnly:true,sourceTotalsSha256:createHash('sha256').update(bytes).digest('hex'),
    rendererAndPreload:'unchanged final package',main:'production IPC validation and read models; fixture read-only handlers',
    nativeHelperStarted:false,realInputObserved:false,screenshotsSaved:false,originalDbWritten:false,
    fixtureDay:today,sourceDay:input.rows[0].day,runtimeElectronVersion:process.versions.electron,list,records:rendered,passed:true};
  writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));
  console.log('RECORDS_REPLAY_OK');clearTimeout(timer);window.destroy();app.quit();
}).catch(() => {console.log('RECORDS_REPLAY_FAILED '+stage);clearTimeout(timer);app.exit(1);});
