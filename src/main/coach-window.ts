import { join } from "node:path";
import { app, BrowserWindow } from "electron";
import { SerialQueue } from "../core/serial-queue.ts";
import type { Bounds, Snapshot } from "../shared/coach";
import { isNormalBounds } from "../shared/window.ts";
import { visibleNormalBounds } from "./window-bounds.ts";

type WindowPreferences = {
  saved?: Bounds;
  workAreas(): Bounds[];
  save(bounds: Bounds): Promise<void>;
};

export class CoachWindow {
  private window: BrowserWindow | null = null;
  private preferences?: WindowPreferences;
  private normal?: Bounds;
  private timer?: NodeJS.Timeout;
  private saving: Promise<void> = Promise.resolve();
  private saves = new SerialQueue();
  private disposed = false;
  private snapshot?: Snapshot;
  private stateVersion = 0;
  private dirty = false;
  private ready = false;
  private showRequested = false;

  get current(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  async create(
    load: (window: BrowserWindow, mode: string) => Promise<void>,
    isQuitting: () => boolean,
    preferences?: WindowPreferences,
  ): Promise<BrowserWindow> {
    if (this.current) return this.current;
    this.preferences = preferences;
    this.disposed = false;
    this.normal = preferences
      ? visibleNormalBounds(preferences.saved, preferences.workAreas())
      : undefined;
    this.dirty =
      !!preferences &&
      JSON.stringify(preferences.saved) !== JSON.stringify(this.normal);
    const window = new BrowserWindow({
      width: 1120,
      height: 700,
      ...this.normal,
      minWidth: 800,
      minHeight: 600,
      show: false,
      frame: false,
      icon: app.isPackaged
        ? join(process.resourcesPath, "icons", "icon.png")
        : join(app.getAppPath(), "build", "icon.png"),
      autoHideMenuBar: true,
      backgroundColor: "#ffffff",
      webPreferences: {
        preload: join(__dirname, "../preload/index.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.window = window;
    this.ready = false;
    const remember = () => {
      if (
        !preferences ||
        this.disposed ||
        window.isMaximized() ||
        window.isMinimized()
      )
        return;
      const bounds = window.getNormalBounds();
      if (
        !isNormalBounds(bounds) ||
        JSON.stringify(bounds) === JSON.stringify(this.normal)
      )
        return;
      this.normal = bounds;
      this.dirty = true;
      // Coalesce the latest value with a bounded write interval even during long drags.
      this.timer ??= setTimeout(() => {
        this.timer = undefined;
        void this.flush().catch(() => {});
      }, 250);
    };
    window.on("move", remember);
    window.on("resize", remember);
    const stateChanged = () => {
      if (this.snapshot) this.publish(this.snapshot);
    };
    window.on("maximize", stateChanged);
    window.on("unmaximize", stateChanged);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.on("close", (event) => {
      if (!isQuitting()) {
        event.preventDefault();
        this.hide();
      }
    });
    window.on("closed", () => {
      clearTimeout(this.timer);
      this.timer = undefined;
      if (this.window === window) this.window = null;
    });
    await load(window, "coach");
    this.ready = true;
    if (this.showRequested) this.show();
    return window;
  }

  show(): void {
    this.showRequested = true;
    const window = this.current;
    if (!window || !this.ready) return;
    this.showRequested = false;
    if (window.isMinimized()) window.restore();
    this.correctBounds();
    window.show();
    window.focus();
  }

  hide(): void {
    this.showRequested = false;
    this.current?.hide();
  }

  correctBounds(): void {
    const window = this.current;
    if (!window || !this.preferences || this.disposed) return;
    const before = window.getNormalBounds();
    const next = visibleNormalBounds(before, this.preferences.workAreas());
    if (JSON.stringify(before) === JSON.stringify(next)) return;
    const maximized = window.isMaximized();
    const minimized = window.isMinimized();
    if (minimized) window.restore();
    if (maximized) window.unmaximize();
    window.setBounds(next);
    this.normal = next;
    this.dirty = true;
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch(() => {});
    }, 250);
    if (maximized) window.maximize();
    if (minimized) window.minimize();
  }

  async flush(dispose = false): Promise<void> {
    if (dispose) this.disposed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    const bounds = this.normal;
    if (bounds && this.preferences && this.dirty) {
      this.dirty = false;
      const save = this.preferences.save;
      this.saving = this.saves.run(async () => {
        try {
          await save(bounds);
        } catch (error) {
          if (this.normal === bounds) this.dirty = true;
          throw error;
        }
      });
    }
    await this.saving;
  }
  resumeBounds(): void {
    this.disposed = false;
  }

  command(command: "minimize" | "maximize" | "hide"): void {
    const window = this.current;
    if (!window) return;
    if (command === "hide") this.hide();
    else if (command === "minimize") window.minimize();
    else if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  }

  withWindowState(snapshot: Snapshot): Snapshot {
    return {
      ...snapshot,
      stateVersion: this.stateVersion,
      windowMaximized: this.current?.isMaximized() ?? false,
    };
  }
  publish(snapshot: Snapshot): void {
    this.stateVersion++;
    this.snapshot = snapshot;
    this.current?.webContents.send(
      "coach:changed",
      this.withWindowState(snapshot),
    );
  }
}
