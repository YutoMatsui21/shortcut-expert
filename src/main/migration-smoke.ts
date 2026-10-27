import assert from 'node:assert/strict';
import { app, type BrowserWindow } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Coach } from '../core/coach';
import { SqliteRepository } from './sqlite-repository';
import { waitFor } from './storage-smoke';
import { selectPage } from './learning-smoke';

export async function runMigrationSmoke({ coach, window, repository }: {
  coach: Pick<Coach, keyof Coach>; window: BrowserWindow; repository: unknown;
}) {
  assert.ok(repository instanceof SqliteRepository);
  const state = coach.snapshot(); assert.equal(state.error, null);
  assert.equal(state.settings.opened, true); assert.equal(state.settings.states?.W03, 'excluded');
  assert.equal(state.settings.states?.W12, 'learning');
  const learning = await window.webContents.executeJavaScript('window.coach.getLearning()');
  assert.equal(learning.rows.length, 12);
  assert.equal(learning.rows.find((row: { id: string }) => row.id === 'W03').state, 'excluded');
  assert.equal(learning.rows.some((row: { id: string }) => row.id === 'W09' || row.id === 'W14'), false);
  assert.deepEqual(await window.webContents.executeJavaScript(`[...document.querySelectorAll('.records-page select')].map(s=>s.value)`),['7','learning-mastered','rate']);
  await selectPage(window, '記録');
  const old = '2020-01-02';
  const rows = await repository.query(old, old);
  assert.equal(rows.counts[old].W03?.mouse, 7); assert.equal(rows.counts[old].W03?.key, 5);
  assert.equal(rows.counts[old].W09?.mouse, 100); assert.equal(rows.coverage[old].W03?.knowledge, 'legacy-unknown');
  const summary = await window.webContents.executeJavaScript('window.coach.getRecordSummary()');
  assert.equal(summary.summary.total, null);
  assert.equal(summary.rows.length, 8);
  assert.equal(summary.rows.some((row: {id:string}) => row.id === 'W03'),false);
  await window.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('.records-page select[aria-label="集計対象"]');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'all');
    select.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await waitFor(window, `document.querySelector('[data-operation="W03"] [data-kind="mouse"]')?.textContent==='—' &&
    document.querySelector('[data-operation="W09"]')===null &&
    document.querySelector('[data-kpi="key"]')?.textContent==='—'`, 'migration-renderer');
  assert.equal(await readFile(join(app.getPath('userData'), 'counts.json'), 'utf8'),
    '  {"schemaVersion":1,"days":{"2020-01-02":{"W03":{"mouse":7,"key":5},"W09":{"mouse":100,"key":100}}}}\n');
  return { fixtureOnly: true, migratedRows: true, legacyUnknown: true, excludedRetained: true,
    sourceBytesPreserved: true, oldRecordsExcludedFromSevenDays: true, deferredOperationsExcluded: true, naturalInputVerified: false };
}
