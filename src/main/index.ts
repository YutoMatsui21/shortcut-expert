import { join, basename } from 'node:path';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { app, dialog, Notification, type BrowserWindow } from 'electron';
import { runCoach, showCoach } from './coach-app.ts';

const fixture = process.argv.includes('--coach-smoke') || process.argv.includes('--storage-smoke') || process.argv.includes('--migration-smoke');
if (fixture) console.log('COACH_IDENTITY ' + JSON.stringify({ packaged: app.isPackaged, name: app.getName(), userDataDirectory: basename(app.getPath('userData')) }));
function fixtureData(): string {
  if (process.env.COACH_TEST_DATA_DIR) return process.env.COACH_TEST_DATA_DIR;
  const directory = app.isPackaged ? join(app.getPath('temp'), 'window-shortcut-coach-tests') : join(app.getAppPath(), '.tools', 'tests');
  mkdirSync(directory, { recursive: true });
  return mkdtempSync(join(directory, 'coach-'));
}
const data = fixture ? fixtureData() : app.isPackaged ? app.getPath('userData') : join(app.getAppPath(), '.tools', 'coach-data');
mkdirSync(data, { recursive: true });
app.setPath('userData', data);

async function loadWindow(window: BrowserWindow, mode: string): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) await window.loadURL(process.env.ELECTRON_RENDERER_URL + '?mode=' + mode);
  else await window.loadFile(join(__dirname, '../renderer/index.html'), { query: { mode } });
}

if (!app.requestSingleInstanceLock()) app.exit(1);
else {
  // Keep the presenter alive without issuing a toast. handleActivation alone does
  // not initialize Electron's Windows presenter/COM class factory on a cold boot.
  let activationPresenter: Electron.Notification | undefined;
  app.once('will-quit', () => { activationPresenter?.removeAllListeners(); activationPresenter = undefined; });
  app.whenReady().then(() => {
    if (!fixture) {
      app.setAppUserModelId('local.window-shortcut-coach');
      Notification.handleActivation(() => showCoach());
      activationPresenter = new Notification();
    }
    if (fixture && process.argv.includes('--activation-smoke')) showCoach();
    return runCoach(loadWindow, fixture);
  }).catch(() => {
    if (!fixture) dialog.showErrorBox('起動できません', '安全に初期化できませんでした。アプリを終了します。保存先とWindowsの状態を確認して再起動してください。');
    console.error('COACH_START_FAILED'); app.exit(1);
  });
  app.on('second-instance', showCoach);
}
