import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { Notice } from '../shared/coach';
import type { ObserverClient } from './observer';

export class NotificationWindow {
  private window: BrowserWindow | null = null;
  private notice: Notice | null = null;
  private timer: NodeJS.Timeout | undefined;
  private poll: NodeJS.Timeout | undefined;
  private epoch = 0;
  private observer: ObserverClient;
  private load: (window: BrowserWindow, mode: string) => Promise<void>;
  constructor(observer: ObserverClient, load: (window: BrowserWindow, mode: string) => Promise<void>) {
    this.observer = observer; this.load = load;
  }
  current(): Notice | null { return this.notice; }
  sender(id: number): boolean { return id === this.window?.webContents.id; }
  focusable(): boolean { return this.window?.isFocusable() ?? false; }
  dismiss(): void {
    this.epoch++;
    clearTimeout(this.timer); clearInterval(this.poll);
    this.window?.destroy(); this.window = null; this.notice = null;
  }
  async show(notice: Notice): Promise<boolean> {
    if (this.window) return false;
    const epoch = this.epoch;
    try {
      const bounds = screen.screenToDipRect(null, notice.monitor);
      const display = screen.getDisplayMatching(bounds);
      if (['x', 'y', 'width', 'height'].some((key) => Math.abs(bounds[key as keyof typeof bounds] - display.bounds[key as keyof typeof bounds]) > 2)) return false;
      const context = await this.observer.context(notice.monitor);
      if (performance.now() >= notice.expiresAt || epoch !== this.epoch || !context.known || context.fullscreen) return false;
      const width = Math.min(320, display.workArea.width - 24), height = 100;
      if (width < 160 || display.workArea.height < height + 24) return false;
      this.notice = notice;
      const window = new BrowserWindow({
        width, height, x: display.workArea.x + display.workArea.width - width - 12,
        y: display.workArea.y + display.workArea.height - height - 12,
        show: false, frame: false, focusable: false, skipTaskbar: true,
        alwaysOnTop: true, resizable: false, backgroundColor: '#173c34',
        webPreferences: { preload: this.preload(), contextIsolation: true, nodeIntegration: false, sandbox: true }
      });
      this.window = window;
      window.setIgnoreMouseEvents(true);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      await this.load(window, 'notice');
      const latest = await this.observer.context(notice.monitor);
      if (performance.now() >= notice.expiresAt || epoch !== this.epoch || this.window !== window || window.isDestroyed() || !latest.known || latest.fullscreen) { if (this.window === window) this.dismiss(); return false; }
      window.showInactive();
      this.timer = setTimeout(() => this.dismiss(), 4000);
      let checking = false;
      this.poll = setInterval(async () => {
        if (checking) return; checking = true;
        try { const value = await this.observer.context(notice.monitor); if (!value.known || value.fullscreen) this.dismiss(); }
        catch { this.dismiss(); }
        finally { checking = false; }
      }, 500);
      return true;
    } catch { this.dismiss(); return false; }
  }
  private preload(): string { return join(__dirname, '../preload/index.cjs'); }
}
