import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, type BrowserWindow } from 'electron';
import { localDate } from '../core/dates';
import { daysBefore, type RecordMutation } from '../shared/storage';
import { learningOperations } from '../shared/learning';
import type { SqliteRepository } from './sqlite-repository';
import { selectPage, waitForLearning } from './learning-smoke';

// Called only by --storage-smoke --comparison-smoke, before the fixture Coach is created.
export async function seedComparisonCoverage(repository: SqliteRepository) {
  const today = localDate(), state = await repository.load(today);
  let sequence = 0;
  // Complete coverage must be born observed; migration's unknown/gap is deliberately irreversible.
  for (const offset of [0,7]) for (const origin of ['mouse','key'] as const) {
    const times = offset === 0 ? origin === 'key' ? 3 : 1 : origin === 'mouse' ? 3 : 1;
    for (let i=0;i<times;i++) await repository.commit({epoch:state.epoch,writeSession:repository.session,sequence:++sequence,today,
      coverage:[],count:{day:daysBefore(today,offset),operation:'W03',origin}});
  }
  for (let offset = 0; offset < 60; offset++) {
    const day = daysBefore(today, offset), next = daysBefore(day, -1);
    const activeMs = new Date(next + 'T00:00:00').getTime() - new Date(day + 'T00:00:00').getTime();
    const coverage: RecordMutation['coverage'] = (['W03', 'W13'] as const).map(operation => ({day, operation,
      value:{knowledge:'observed',activeMs,gap:false,capabilityRevision:'comparison-fixture'}}));
    if (offset === 7) coverage.push({day,operation:'W02',value:{knowledge:'observed',activeMs:1000,gap:true,capabilityRevision:'comparison-fixture'}});
    if (offset === 0) coverage.push({day,operation:'W04',value:{knowledge:'observed',activeMs:1000,gap:true,capabilityRevision:'comparison-fixture'}});
    await repository.commit({epoch:state.epoch,writeSession:repository.session,sequence:++sequence,today,coverage});
  }
  await repository.saveSettings({opened:true,muted:[],states:Object.fromEntries(learningOperations.map(op => [op.id, op.id === 'W03' ? 'learning' : op.id === 'W13' ? 'mastered' : 'excluded']))});
}

export async function runRecordsComparisonSmoke(window: BrowserWindow) {
  window.show(); window.focus();
  await selectPage(window, '記録');
  const ready = () => waitForLearning(window, `document.querySelector('.records-scroll')?.getAttribute('aria-busy') === 'false'`);
  const choose = async (label: string, value: string) => {
    await window.webContents.executeJavaScript(`(() => {
      const select = document.querySelector('.records-page select[aria-label=${JSON.stringify(label)}]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(value)});
      select.dispatchEvent(new Event('change', {bubbles:true}));
    })()`); await ready();
  };
  const read = () => window.webContents.executeJavaScript(`(() => {
    const text = selector => document.querySelector(selector)?.textContent;
    return {rate:text('[data-kpi="rate"]'),key:text('[data-kpi="key"]'),mouse:text('[data-kpi="mouse"]'),
      improvement:text('.record-usage [data-comparison]'),keyDifference:text('.record-counts dl > div:first-child [data-comparison]'),
      mouseDifference:text('.record-counts dl > div:last-child [data-comparison]'), info:document.querySelectorAll('.records-page .coverage-info').length,
      rows:[...document.querySelectorAll('.record-table tbody tr')].map(row => ({id:row.dataset.operation,
        improvement:row.querySelector('[data-comparison]').textContent, missing:!!row.querySelector('.coverage-info'),
        mouse:row.querySelector('[data-kind="mouse"]').textContent,key:row.querySelector('[data-kind="key"]').textContent,
        rate:row.querySelector('.record-rate').textContent}))};
  })()`);
  await ready();
  let view = await read();
  assert.equal(view.rate, '75.0%'); assert.equal(view.improvement, '+50.0pt'); assert.equal(view.info, 0);
  await choose('集計対象', 'all');
  view = await read();
  assert.equal(view.key,'8回'); assert.equal(view.mouse,'3回');
  assert.equal(view.improvement,'+50.5pt'); assert.equal(view.keyDifference,'+6'); assert.equal(view.mouseDifference,'-4');
  const row = (id: string) => view.rows.find((r: {id:string}) => r.id === id)!;
  assert.equal(row('W03').improvement,'+50.0pt'); assert.equal(row('W03').missing,false);
  assert.equal(row('W11').improvement,'+25.0pt'); assert.equal(row('W11').missing,true); // legacy positive counts
  assert.equal(row('W02').improvement,'—'); assert.equal(row('W02').key,'2'); // prior known zero
  assert.equal(row('W04').improvement,'—'); assert.equal(row('W04').key,'0'); assert.ok(row('W04').rate.includes('記録なし'));
  assert.equal(row('W06').improvement,'—'); assert.equal(row('W06').key,'0'); assert.ok(row('W06').rate.includes('0.0%'));
  assert.equal(row('W07').improvement,'—'); assert.equal(row('W07').key,'—');
  assert.equal(row('W13').improvement,'—'); assert.equal(row('W13').missing,false);
  assert.equal(view.info,13); // 3 summary comparisons + 10 incomplete rows
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.record-table-heading [aria-label="キー率の計算方法"]')?.querySelector('img').classList.contains('imgHelpIconHover')`),true);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.coverage-info').getAttribute('aria-label').includes('記録の欠損について')`),true);

  // Count differences for observed zero / unknown must also arrive intact over the real IPC.
  const model = await window.webContents.executeJavaScript(`window.coach.getRecordSummary({period:7,filter:'all',sort:'rate'})`);
  assert.equal(model.rows.find((r: {id:string}) => r.id === 'W02').comparison.key,2);
  assert.equal(model.rows.find((r: {id:string}) => r.id === 'W04').comparison.mouse,-2);
  assert.equal(model.rows.find((r: {id:string}) => r.id === 'W06').comparison.total,null);
  assert.equal(model.rows.find((r: {id:string}) => r.id === 'W07').comparison.total,null);
  const sizes = [];
  for (const width of [800,920,1120,1360]) {
    window.setContentSize(width,700);
    await waitForLearning(window, `Math.abs(innerWidth - ${width}) <= 1`);
    const actual = await window.webContents.executeJavaScript('innerWidth');
    if (actual !== width) window.setSize(window.getSize()[0] + width - actual, window.getSize()[1]);
    await waitForLearning(window, `innerWidth === ${width}`);
    await window.webContents.executeJavaScript(`document.fonts.ready`);
    const info = `.record-usage .coverage-info`;
    await window.webContents.executeJavaScript(`document.querySelector('${info}').focus()`);
    await waitForLearning(window, `!!document.querySelector('.coverage-tooltip')`);
    const geometry = await window.webContents.executeJavaScript(`(() => {
      const tooltip = document.querySelector('.coverage-tooltip'), button = document.querySelector('${info}'), r = tooltip.getBoundingClientRect();
      return {text:tooltip.textContent,linked:button.getAttribute('aria-describedby') === tooltip.id,
        left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:document.querySelector('.records-scroll').scrollWidth > document.querySelector('.records-scroll').clientWidth,
        infoWidth:button.querySelector('img').getBoundingClientRect().width};
    })()`);
    assert.equal(geometry.text,'一部の時間帯で記録を取得できていないため、実際の利用状況と異なる可能性があります。');
    assert.equal(geometry.linked,true); assert.equal(geometry.overflow,false); assert.equal(geometry.infoWidth,18);
    assert.ok(geometry.left >= 0 && geometry.right <= width && geometry.top >= 0 && geometry.bottom <= 700);
    sizes.push({width,...geometry});
    await writeFile(join(app.getPath('userData'),`records-comparison-${width}.png`),(await window.webContents.capturePage()).toPNG());
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await waitForLearning(window, `!document.querySelector('.coverage-tooltip')`);
    assert.equal(await window.webContents.executeJavaScript(`document.activeElement === document.querySelector('${info}')`),true);
    // Native button activation by keyboard (space), click toggling and outside dismissal.
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'}); window.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});
    await waitForLearning(window, `!!document.querySelector('.coverage-tooltip')`);
    await window.webContents.executeJavaScript(`document.querySelector('${info}').click()`);
    await waitForLearning(window, `!document.querySelector('.coverage-tooltip')`);
    await window.webContents.executeJavaScript(`document.querySelector('${info}').click()`);
    await waitForLearning(window, `!!document.querySelector('.coverage-tooltip')`);
    await window.webContents.executeJavaScript(`document.querySelector('h1').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
    await waitForLearning(window, `!document.querySelector('.coverage-tooltip')`);
    await window.webContents.executeJavaScript(`document.querySelector('${info}').blur()`);
    const point = await window.webContents.executeJavaScript(`(() => { const r = document.querySelector('${info}').getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
    window.webContents.sendInputEvent({type:'mouseMove',...point});
    await waitForLearning(window, `!!document.querySelector('.coverage-tooltip')`);
    window.webContents.sendInputEvent({type:'mouseMove',x:60,y:40});
    await waitForLearning(window, `!document.querySelector('.coverage-tooltip')`);
    // The bottom/right row tooltip must stay inside the viewport, and use the info icon.
    await window.webContents.executeJavaScript(`document.querySelector('[data-operation="W11"] .coverage-info').focus()`);
    await waitForLearning(window, `!!document.querySelector('[data-operation="W11"] .coverage-tooltip')`);
    assert.equal(await window.webContents.executeJavaScript(`(() => { const r = document.querySelector('[data-operation="W11"] .coverage-tooltip').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`),true);
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}); window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await waitForLearning(window, `!document.querySelector('.coverage-tooltip')`);
    await window.webContents.executeJavaScript(`document.querySelector('[data-operation="W11"] .coverage-info').blur(); document.querySelector('.records-scroll').scrollTop = 0`);
  }
  // Changing the filter removes the stale warning and open tooltip, including a pinned one.
  await window.webContents.executeJavaScript(`document.querySelector('.record-usage .coverage-info').click()`);
  await choose('集計対象','learning');
  view = await read(); assert.equal(view.info,0); assert.equal(view.improvement,'+50.0pt');
  assert.equal(await window.webContents.executeJavaScript(`!!document.querySelector('.coverage-tooltip')`),false);
  await choose('期間','30'); view = await read();
  assert.equal(view.keyDifference,'+4'); assert.equal(view.mouseDifference,'+4'); assert.equal(view.improvement,'—'); assert.equal(view.info,0);
  await choose('期間','7');
  await window.webContents.executeJavaScript(`window.coach.setLearningState('W03','excluded')`); await ready();
  view = await read(); assert.equal(view.rate,'—'); assert.equal(view.key,'—'); assert.equal(view.info,0); assert.equal(view.rows.length,0);
  await choose('集計対象','learning-mastered'); view = await read();
  assert.equal(view.rate,'記録なし'); assert.equal(view.key,'0回'); assert.equal(view.keyDifference,'0'); assert.equal(view.improvement,'—'); assert.equal(view.info,0);
  // Isolate each decision-table row as a KPI as well, so count differences are visibly asserted.
  const decisions = [];
  for (const [id,expected] of [
    ['W02',{rate:'100.0%',key:'2回',mouse:'0回',keyDifference:'+2',mouseDifference:'0',improvement:'—'}],
    ['W04',{rate:'記録なし',key:'0回',mouse:'0回',keyDifference:'0',mouseDifference:'-2',improvement:'—'}],
    ['W06',{rate:'0.0%',key:'0回',mouse:'1回',keyDifference:'—',mouseDifference:'—',improvement:'—'}],
    ['W07',{rate:'—',key:'—',mouse:'—',keyDifference:'—',mouseDifference:'—',improvement:'—'}],
    ['W11',{rate:'75.0%',key:'3回',mouse:'1回',keyDifference:'+2',mouseDifference:'0',improvement:'+25.0pt'}]
  ] as const) {
    await window.webContents.executeJavaScript(`window.coach.setLearningState('${id}','learning')`);
    await choose('集計対象','learning');
    view = await read();
    for (const [key,value] of Object.entries(expected)) assert.equal(view[key],value,id + ' ' + key);
    assert.equal(view.info,4); // summary's 3 comparisons + the selected operation
    decisions.push({id,...view});
    await window.webContents.executeJavaScript(`window.coach.setLearningState('${id}','excluded')`); await ready();
  }
  await writeFile(join(app.getPath('userData'),'records-comparison-decisions.json'),JSON.stringify({fixtureOnly:true,decisions},null,2));
  await writeFile(join(app.getPath('userData'),'records-comparison-layout.json'),JSON.stringify({fixtureOnly:true,sizes},null,2));
  return {fixtureOnly:true,comparisonDecisionTable:true,sqliteWorker:true,realIpc:true,keyboardInfo:true,fourWidths:true,filters:true,naturalInputVerified:false};
}
