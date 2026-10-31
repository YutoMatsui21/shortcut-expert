import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, type BrowserWindow } from 'electron';
import { learningOperations } from '../shared/learning';

export async function waitForLearning(window: BrowserWindow, condition: string): Promise<void> {
  const passed = await window.webContents.executeJavaScript(`new Promise(resolve => {
    const end = Date.now() + 4000; const timer = setInterval(() => {
      if (${condition}) { clearInterval(timer); resolve(true); }
      else if (Date.now() > end) { clearInterval(timer); resolve(false); }
    }, 25);
  })`);
  assert.equal(passed, true, condition);
}
export async function selectPage(window: BrowserWindow, page: '記録' | 'ショートカット一覧'): Promise<void> {
  await window.webContents.executeJavaScript(`document.querySelector('nav button[aria-label="${page}"]').click()`);
  await waitForLearning(window, `document.querySelector('nav button[aria-label="${page}"]').getAttribute('aria-current') === 'page'`);
}
export async function runLearningSmoke(window: BrowserWindow) {
  await selectPage(window, 'ショートカット一覧');
  await waitForLearning(window, `document.querySelector('[data-learning-operation="W03"] .key-rate')?.textContent.includes('50.0%')`);
  const read = await window.webContents.executeJavaScript('window.coach.getLearning()');
  assert.equal(read.rows.length, 8);
  assert.deepEqual(read.rows.map((row: { id: string }) => row.id), learningOperations.map(op => op.id));
  assert.equal(read.rows.find((row: { id: string }) => row.id === 'W03').total, 2);
  const initialCounts = await window.webContents.executeJavaScript('window.coach.getSnapshot().then(value => value.counts)');
  for (const state of ['mastered', 'excluded', 'learning']) {
    await window.webContents.executeJavaScript(`(() => {
      const select = document.querySelector('[data-learning-operation="W03"] select');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '${state}');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitForLearning(window, `document.querySelector('[data-learning-operation="W03"] select').value === '${state}' && !document.querySelector('[data-learning-operation="W03"] select').disabled`);
    const value = await window.webContents.executeJavaScript('window.coach.getLearning()');
    assert.equal(value.rows.find((row: { id: string }) => row.id === 'W03').state, state);
    await waitForLearning(window, `document.querySelector('.learning-summary .${state} > span').textContent === '${state === 'learning' ? 8 : 1}'`);
    await selectPage(window, '記録'); await selectPage(window, 'ショートカット一覧');
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-learning-operation="W03"] select').value`), state);
  }
  assert.deepEqual(await window.webContents.executeJavaScript('window.coach.getSnapshot().then(value => value.counts)'), initialCounts);
  await window.webContents.executeJavaScript(`window.coach.setLearningState('W03', 'mastered')`);
  await window.webContents.executeJavaScript('location.reload()');
  await waitForLearning(window, `document.querySelector('[data-learning-operation="W03"] select')?.value === 'mastered'`);
  await writeFile(join(app.getPath('userData'), 'learning-mastered.png'), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(`window.coach.setLearningState('W03', 'learning')`);
  await waitForLearning(window, `document.querySelector('[data-learning-operation="W03"] select')?.value === 'learning'`);
  const sizes = [];
  for (const width of [800, 920, 1120, 1360]) {
    window.setContentSize(width, 700);
    await waitForLearning(window, `Math.abs(innerWidth - ${width}) <= 1`);
    // Win32 invisible borders can leave setContentSize one DIP short at high DPI.
    // Keep both measurements; the layout assertions use actual CSS viewport width.
    const nominal = { bounds: window.getBounds(), content: window.getContentBounds(), viewport: await window.webContents.executeJavaScript('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})') };
    const actualWidth = nominal.viewport.width;
    if (actualWidth !== width) window.setSize(window.getSize()[0] + width - actualWidth, window.getSize()[1]);
    await waitForLearning(window, `window.innerWidth === ${width}`);
    await window.webContents.executeJavaScript('document.fonts.ready');
    const geometry = await window.webContents.executeJavaScript(`(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      return { viewport: innerWidth, content: rect('.page-scroll'), row: rect('.learning-row'), title: rect('.titlebar'), nav: rect('nav'),
        overflow: document.querySelector('.page-scroll').scrollWidth > document.querySelector('.page-scroll').clientWidth,
        groups: [...document.querySelectorAll('.learning-rows')].map(group => group.children.length),
        ready: document.querySelectorAll('.learning-row .availability').length,
        assets: [...document.querySelectorAll('.page-frame img, .titlebar img, nav img')].filter(img => !img.complete || img.naturalWidth === 0).map(img => img.className),
        fonts: { noto: document.fonts.check('14px "Noto Sans JP"', '学習中'), inter: document.fonts.check('12px Inter', 'Shortcut Expert') },
        background: getComputedStyle(document.querySelector('.learning-row')).backgroundColor };
    })()`);
    assert.equal(geometry.title.height, 32); assert.equal(geometry.nav.width, 48);
    assert.deepEqual(geometry.groups, [2, 2, 3, 1]); assert.equal(geometry.ready, 0);
    assert.deepEqual(geometry.assets, []); assert.ok(geometry.fonts.noto && geometry.fonts.inter, JSON.stringify(geometry.fonts)); assert.equal(geometry.overflow, false);
    assert.equal(Math.round(geometry.content.width), Math.min(width - 248, 872));
    assert.equal(Math.round(geometry.content.x), width < 1360 ? 148 : 268);
    assert.equal(Math.round(geometry.content.y), width < 1120 ? 191 : 146);
    assert.ok(geometry.row.height >= (width === 800 ? 92 : 64));
    sizes.push({ requested: width, nominal, bounds: window.getBounds(), windowContent: window.getContentBounds(), ...geometry });
    await writeFile(join(app.getPath('userData'), `learning-${width}.png`), (await window.webContents.capturePage()).toPNG());
  }
  window.setContentSize(800, 700);
  await waitForLearning(window, `Math.abs(innerWidth - 800) <= 1`);
  const scrollWidth = await window.webContents.executeJavaScript('innerWidth');
  if (scrollWidth !== 800) window.setSize(window.getSize()[0] + 800 - scrollWidth, window.getSize()[1]);
  await waitForLearning(window, `innerWidth === 800`);
  await window.webContents.executeJavaScript(`document.querySelector('.group-header').click(); document.querySelector('.page-scroll').scrollTop = 120`);
  await waitForLearning(window, `document.querySelector('.group-header').getAttribute('aria-expanded') === 'false'`);
  await selectPage(window, '記録'); await selectPage(window, 'ショートカット一覧');
  await waitForLearning(window, `document.querySelector('.group-header').getAttribute('aria-expanded') === 'false' && document.querySelector('.page-scroll').scrollTop === 120`);
  await window.webContents.executeJavaScript(`document.querySelector('.group-header').click()`);
  await waitForLearning(window, `document.querySelector('.group-header').getAttribute('aria-expanded') === 'true'`);
  window.setContentSize(1120, 700);
  await selectPage(window, '記録');
  await writeFile(join(app.getPath('userData'), 'learning-layout.json'), JSON.stringify({ fixtureOnly: true, sizes }, null, 2));
}
