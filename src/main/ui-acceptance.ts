import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, screen, type BrowserWindow } from 'electron';
import { selectPage, waitForLearning } from './learning-smoke';

// Isolated fixture entry only. Keep nominal dimensions separate from corrected
// CSS viewports: a corrected screenshot cannot prove the product's initial size.
export async function runUiAcceptance(window: BrowserWindow): Promise<void> {
  await waitForLearning(window, `document.querySelectorAll('.learning-row').length === 12`);
  const measure = async () => ({ bounds: window.getBounds(), content: window.getContentBounds(),
    viewport: await window.webContents.executeJavaScript('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})'),
    scaleFactor: screen.getDisplayMatching(window.getBounds()).scaleFactor });
  const initial = await measure();
  const samples = [];
  for (const page of ['ショートカット一覧', '記録'] as const) {
    await selectPage(window, page);
    await waitForLearning(window, page === '記録'
      ? `document.querySelector('.records-scroll')?.getAttribute('aria-busy') === 'false' && document.querySelectorAll('.record-table tbody tr').length === 12`
      : `document.querySelectorAll('.learning-row').length === 12`);
    for (const [width, height] of [[800,600],[800,700],[919,700],[920,700],[1119,700],[1120,700],[1359,700],[1360,700]]) {
      window.setContentSize(width, height);
      await waitForLearning(window, `Math.abs(innerWidth - ${width}) <= 1 && Math.abs(innerHeight - ${height}) <= 1`);
      const nominal = await measure();
      window.setSize(nominal.bounds.width + width - nominal.viewport.width, nominal.bounds.height + height - nominal.viewport.height);
      await new Promise(resolve => setTimeout(resolve, 150));
      await waitForLearning(window, `innerWidth === ${width}`);
      await window.webContents.executeJavaScript('document.fonts.ready');
      const geometry = await window.webContents.executeJavaScript(`(() => {
        const scroll = document.querySelector('${page === '記録' ? '.records-scroll' : '.page-scroll'}');
        const r = scroll.getBoundingClientRect();
        return { x:r.x, y:r.y, width:r.width, horizontalOverflow:scroll.scrollWidth > scroll.clientWidth,
          bodyOverflow:document.documentElement.scrollWidth > innerWidth,
          rows:document.querySelectorAll('${page === '記録' ? '.record-table tbody tr' : '.learning-row'}').length };
      })()`);
      const corrected = await measure();
      samples.push({page, requested:{width,height}, nominal, corrected,
        dimensionsMatched:corrected.viewport.width === width && corrected.viewport.height === height, geometry});
      // Persist partial evidence as well if a later assertion fails.
      await writeFile(join(app.getPath('userData'), 'ui-acceptance.json'), JSON.stringify({fixtureOnly:true,
        initial, displays:screen.getAllDisplays().map(d => ({bounds:d.bounds,workArea:d.workArea,scaleFactor:d.scaleFactor})), samples},null,2));
      assert.equal(geometry.horizontalOverflow, false);
      assert.equal(geometry.bodyOverflow, false);
      assert.equal(geometry.rows, 12);
      assert.equal(Math.round(geometry.width), Math.min(width - 248, 872));
      assert.equal(Math.round(geometry.x), Math.round(width <= 1120 ? 148 : (width - 872 + 48) / 2));
      assert.equal(Math.round(geometry.y), page === '記録' ? width < 1120 ? 202 : 132 : width < 1120 ? 191 : 146);
      await writeFile(join(app.getPath('userData'), `ui-${page === '記録' ? 'records' : 'learning'}-${width}x${height}.png`),
        (await window.webContents.capturePage()).toPNG());
    }
  }
  await selectPage(window, 'ショートカット一覧');
  window.setBounds(initial.bounds);
  console.log('V03_MATRIX_COMPLETE ' + JSON.stringify({fixtureOnly:true,samples:samples.length,
    dimensionMismatches:samples.filter(sample => !sample.dimensionsMatched).length,initial}));
}
