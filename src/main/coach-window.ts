import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import type { Snapshot } from '../shared/coach';

export class CoachWindow {
  private window: BrowserWindow | null = null;

  get current(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  async create(load: (window: BrowserWindow, mode: string) => Promise<void>, isQuitting: () => boolean): Promise<BrowserWindow> {
    if (this.current) return this.current;
    const window = new BrowserWindow({ width: 920, height: 760, minWidth: 620, minHeight: 500, show: false,
      autoHideMenuBar: true, backgroundColor: '#f5f4ed',
      webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    this.window = window;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.on('close', (event) => { if (!isQuitting()) { event.preventDefault(); this.hide(); } });
    window.on('closed', () => { if (this.window === window) this.window = null; });
    await load(window, 'coach');
    return window;
  }

  show(): void {
    const window = this.current;
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  hide(): void { this.current?.hide(); }

  publish(snapshot: Snapshot): void { this.current?.webContents.send('coach:changed', snapshot); }
}
