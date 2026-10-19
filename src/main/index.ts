import { join } from 'node:path';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { app, type BrowserWindow } from 'electron';
import { runCoach, showCoach } from './coach-app';

const fixture = process.argv.includes('--coach-smoke') || process.argv.includes('--storage-smoke');
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
  app.whenReady().then(() => runCoach(loadWindow, fixture)).catch(() => {
    console.error('COACH_START_FAILED'); app.exit(1);
  });
  app.on('second-instance', showCoach);
}
