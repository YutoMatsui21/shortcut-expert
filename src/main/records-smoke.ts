import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, type BrowserWindow } from 'electron';
import { selectPage, waitForLearning } from './learning-smoke';
import { learningOperations } from '../shared/learning';

export async function runRecordsSmoke(window: BrowserWindow) {
  await selectPage(window, '記録');
  await waitForLearning(window, `document.querySelector('[data-kpi="rate"]')?.textContent === '50.0%'`);
  const model = await window.webContents.executeJavaScript('window.coach.getRecordSummary()');
  assert.deepEqual(model.query, {period:7,filter:'learning-mastered',sort:'rate'});
  assert.deepEqual(model.rows.map((row: { id: string }) => row.id), ['W03', ...learningOperations.filter(op => op.id !== 'W03').map(op => op.id)]);
  assert.equal(model.summary.mouse, 1); assert.equal(model.summary.key, 1);
  assert.equal('counts' in model, false); assert.equal('coverage' in model, false);
  const choose = async (label: string, value: string) => {
    await window.webContents.executeJavaScript(`(() => {
      const select = document.querySelector('.records-page select[aria-label="${label}"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '${value}');
      select.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    await waitForLearning(window, `document.querySelector('.records-page select[aria-label="${label}"]').value === '${value}' && document.querySelector('.records-scroll').getAttribute('aria-busy') === 'false'`);
  };
  assert.deepEqual(await window.webContents.executeJavaScript(`[...document.querySelectorAll('.records-page select')].map(s => s.options.length)`), [2,3,5]);
  await choose('期間', '30');
  await window.webContents.executeJavaScript(`window.coach.setLearningState('W03','excluded')`);
  await waitForLearning(window, `document.querySelector('.records-scroll').getAttribute('aria-busy') === 'false' && document.querySelectorAll('.record-table tbody tr').length === 11`);
  await choose('集計対象','all');
  await waitForLearning(window, `document.querySelector('[data-kpi="rate"]').textContent === '50.0%' && document.querySelectorAll('.record-table tbody tr').length === 12`);
  for (const sort of ['mouse','improvement','key','total','rate']) {
    await choose('並び替え', sort);
    const expected = await window.webContents.executeJavaScript(`window.coach.getRecordSummary({period:30,filter:'all',sort:'${sort}'}).then(m => m.rows.map(r=>r.id))`);
    assert.deepEqual(await window.webContents.executeJavaScript(`[...document.querySelectorAll('.record-table tbody tr')].map(r=>r.dataset.operation)`),expected);
  }
  await choose('並び替え','total');
  await selectPage(window,'ショートカット一覧'); await selectPage(window,'記録');
  assert.deepEqual(await window.webContents.executeJavaScript(`[...document.querySelectorAll('.records-page select')].map(s=>s.value)`),['30','all','total']);
  await choose('集計対象','learning');
  await waitForLearning(window, `document.querySelector('[data-kpi="rate"]').textContent === '—' && document.querySelectorAll('.record-table tbody tr').length === 11`);
  await window.webContents.executeJavaScript(`window.coach.setLearningState('W03','mastered')`);
  await choose('集計対象','learning-mastered');
  await waitForLearning(window, `document.querySelector('[data-kpi="rate"]').textContent === '50.0%' && document.querySelectorAll('.record-table tbody tr').length === 12`);
  await window.webContents.executeJavaScript(`window.coach.setLearningState('W03','learning')`);
  const loaded = new Promise<void>(resolve => window.webContents.once('did-finish-load', () => resolve()));
  window.webContents.reload(); await loaded;
  await waitForLearning(window, `document.querySelector('nav button[aria-label="ショートカット一覧"]')?.getAttribute('aria-current') === 'page'`);
  assert.deepEqual(await window.webContents.executeJavaScript(`[...document.querySelectorAll('.records-page select')].map(s=>s.value)`),['7','learning-mastered','rate']);
  await selectPage(window,'記録');
  await waitForLearning(window, `document.querySelector('[data-kpi="rate"]').textContent === '50.0%'`);
  const sizes = [];
  for (const width of [800, 920, 1120, 1360]) {
    window.setContentSize(width, 700);
    await waitForLearning(window, `Math.abs(innerWidth - ${width}) <= 1`);
    const actual = await window.webContents.executeJavaScript('innerWidth');
    if (actual !== width) window.setSize(window.getSize()[0] + width - actual, window.getSize()[1]);
    await waitForLearning(window, `innerWidth === ${width}`);
    await window.webContents.executeJavaScript('document.fonts.ready');
    const geometry = await window.webContents.executeJavaScript(`(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
      return { content: rect('.records-scroll'), kpis: rect('.record-kpis'), usage: rect('.record-usage'), counts: rect('.record-counts'),
        row: rect('.record-table tbody tr'), shortcut: rect('.record-shortcut'), rate: rect('.record-rate'),
        overflow: document.querySelector('.records-scroll').scrollWidth > document.querySelector('.records-scroll').clientWidth,
        rows: document.querySelectorAll('.record-table tbody tr').length,
        preparing: document.querySelectorAll('.record-table .availability').length,
        unknown: document.querySelector('[data-operation="W13"] .record-rate').textContent.includes('—'),
        assets: [...document.querySelectorAll('.records-page img')].every(img => img.complete && img.naturalWidth > 0)
      };
    })()`);
    assert.equal(geometry.rows, 12); assert.equal(geometry.preparing, 12);
    assert.equal(geometry.unknown, true); assert.equal(geometry.assets, true); assert.equal(geometry.overflow, false);
    assert.equal(Math.round(geometry.content.width), Math.min(width - 248, 872));
    assert.equal(Math.round(geometry.content.x), width === 1360 ? 268 : 148);
    assert.equal(Math.round(geometry.content.y), width < 1120 ? 202 : 132);
    if (width === 800) { assert.ok(geometry.counts.y > geometry.usage.y + 120); assert.ok(geometry.shortcut.y > geometry.row.y); }
    else { assert.equal(geometry.counts.y, geometry.usage.y); assert.equal(geometry.shortcut.y, geometry.rate.y); }
    sizes.push({width, ...geometry});
    await writeFile(join(app.getPath('userData'), `records-${width}.png`), (await window.webContents.capturePage()).toPNG());
  }
  await window.webContents.executeJavaScript(`document.querySelector('.records-scroll').scrollTop = 100`);
  await selectPage(window, 'ショートカット一覧'); await selectPage(window, '記録');
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.records-scroll').scrollTop`), 100);
  window.setContentSize(1120, 700);
  await writeFile(join(app.getPath('userData'), 'records-layout.json'), JSON.stringify({ fixtureOnly: true, sizes }, null, 2));
}
