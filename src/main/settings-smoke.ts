import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type { CoachBridge, Snapshot } from '../shared/coach';
import { coachTrayMenu } from './coach-tray';
import { selectPage, waitForLearning } from './learning-smoke';

export async function runSettingsSmoke(window: BrowserWindow, snapshot: () => Snapshot, command: CoachBridge['command']) {
  const js = (source: string) => window.webContents.executeJavaScript(source);
  const gear = `document.querySelector('.gear-button')`;
  const control = (name: string) => `document.querySelector('.settings-switch[aria-label="${name}"]')`;
  const open = async () => { await js(`${gear}.click()`); await waitForLearning(window, `!!${control('通知')}`); };
  const key = async (keyCode: string) => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    if (keyCode === 'Enter') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  };
  const state = async (name: string, checked: boolean, disabled = false) => {
    try { await waitForLearning(window, `${control(name)}?.getAttribute('aria-checked') === '${checked}' && ${control(name)}.disabled === ${disabled}`); }
    catch (error) { console.error('SETTINGS_FIXTURE_STATE', await js(`({panel:document.querySelector('.settings-popover')?.outerHTML,focus:document.activeElement?.outerHTML,hasFocus:document.hasFocus(),hidden:document.hidden})`), snapshot()); throw error; }
  };
  const closed = () => waitForLearning(window, `!document.querySelector('.settings-popover') && document.activeElement === ${gear}`);
  window.show(); window.focus();
  await waitForLearning(window, 'document.hasFocus()');
  const sizes = [];
  for (const width of [800, 920, 1120, 1360]) {
    window.setContentSize(width, 600);
    await waitForLearning(window, `Math.abs(innerWidth - ${width}) <= 1`);
    const actual = await js('innerWidth');
    if (actual !== width) window.setSize(window.getSize()[0] + width - actual, window.getSize()[1]);
    await waitForLearning(window, `innerWidth === ${width}`);
    for (const page of ['ショートカット一覧', '記録'] as const) {
      await selectPage(window, page);
      await js(`${gear}.focus()`); await key('Enter');
      await state('通知', true); await state('計測', true);
      const geometry = await js(`(() => {
        const panel = document.querySelector('.settings-popover').getBoundingClientRect();
        const gear = ${gear}.getBoundingClientRect();
        const img = ${control('通知')}.querySelector('img');
        return {x:panel.x,y:panel.y,width:panel.width,height:panel.height,right:panel.right,
          gearRight:gear.right, viewport:innerWidth, image:img.complete && img.naturalWidth > 0,
          switchWidth:img.getBoundingClientRect().width, switchHeight:img.getBoundingClientRect().height};
      })()`);
      assert.equal(geometry.width, 330); assert.equal(geometry.height, 262); assert.equal(geometry.y, 39);
      assert.equal(geometry.right, geometry.gearRight); assert.ok(geometry.x >= 0 && geometry.right <= width);
      assert.ok(geometry.image); assert.equal(geometry.switchWidth, 38); assert.equal(geometry.switchHeight, 22);
      sizes.push({ requestedWidth: width, page, ...geometry });
      await writeFile(join(app.getPath('userData'), `settings-${width}-${page === '記録' ? 'records' : 'learning'}.png`), (await window.webContents.capturePage()).toPNG());
      await key('Escape'); await closed();
      await key('Space'); await state('通知', true);
      await js(`document.querySelector('.page-header').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}))`); await closed();
      await open(); await js(`${gear}.click()`); await closed();
    }
  }
  await open();
  // The first enabled switch receives focus; Space invokes the real React/Preload/Main command.
  await key('Space'); await state('通知', false);
  await js(`${control('計測')}.click()`); await state('計測', false); await state('通知', false, true);
  const stopped = structuredClone(snapshot().counts);
  const tray = coachTrayMenu(snapshot(), command, () => {}, async () => {});
  assert.equal(tray[1].enabled, false); assert.equal(tray[1].label, '通知を再開');
  await command('resume-notifications'); await state('通知', false, true);
  // Invoke the actual tray menu callback and wait for its shared command response via the UI.
  tray[2].click?.({} as Electron.MenuItem, window, {} as Electron.KeyboardEvent);
  await state('計測', true); await state('通知', false);
  assert.deepEqual(snapshot().counts, stopped);
  await command('resume-notifications'); await state('通知', true);
  await command('stop'); await state('通知', true, true);
  await js(`${control('計測')}.click()`); await state('計測', true); await state('通知', true);
  await selectPage(window, 'ショートカット一覧'); await closed();
  await open(); await js(`window.coach.windowCommand('hide')`);
  await waitForLearning(window, `!document.querySelector('.settings-popover')`);
  window.show(); window.focus(); await closed();
  await open(); await js(`window.dispatchEvent(new Event('blur'))`); await closed();
  return { settings: true, sizes, trayCommands: true, keyboard: true, stoppedPausePreserved: true };
}
