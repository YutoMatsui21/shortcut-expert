import { randomUUID } from "node:crypto";
import type { EventEmitter } from "node:events";
import { Notification } from "electron";
import type { ShortcutNotice } from "../shared/coach.ts";

export type NotificationResult = {
  id: string;
  status: "requested" | "api-returned" | "show-event" | "failed" | "unknown";
};
export type NotificationApi = EventEmitter & { show(): void };

// References cover asynchronous events, not Action Center history. Global activation
// handles clicks after release; releasing never calls close() or removes OS history.
export class StandardNotifications {
  private active = new Map<
    string,
    { notification: NotificationApi; timer: NodeJS.Timeout; unknown(): void }
  >();
  private showCoach: () => void;
  private result: (value: NotificationResult) => void;
  private create: (
    options: Electron.NotificationConstructorOptions,
  ) => NotificationApi;
  constructor(
    showCoach: () => void,
    result: (value: NotificationResult) => void,
    create: (
      options: Electron.NotificationConstructorOptions,
    ) => NotificationApi = (options) => new Notification(options),
  ) {
    this.showCoach = showCoach;
    this.result = result;
    this.create = create;
  }

  async show(value: ShortcutNotice): Promise<boolean> {
    const id = randomUUID();
    this.result({ id, status: "requested" });
    let settled = false;
    const report = (status: NotificationResult["status"]) =>
      this.result({ id, status });
    try {
      const items = value.items ?? [value];
      const notification = this.create({
        id,
        title:
          items.length === 1 ? items[0].shortcut : "ショートカットのヒント",
        body:
          items.length === 1
            ? items[0].label
            : items.map((item) => `${item.label}: ${item.shortcut}`).join("\n"),
        silent: true,
        timeoutType: "default",
      });
      const timer = setTimeout(() => {
        if (!settled) report("unknown");
        this.release(id);
      }, 60_000);
      timer.unref();
      this.active.set(id, {
        notification,
        timer,
        unknown: () => {
          if (!settled) report("unknown");
        },
      });
      // A resource cap releases JS references only. Every operation still issues show().
      if (this.active.size > 256) {
        const oldest = this.active.keys().next().value;
        if (oldest) {
          this.active.get(oldest)?.unknown();
          this.release(oldest);
        }
      }
      notification.on("show", () => {
        settled = true;
        report("show-event");
      });
      notification.on("failed", () => {
        settled = true;
        report("failed");
        this.release(id);
      });
      notification.on("click", () => {
        this.showCoach();
        this.release(id);
      });
      notification.on("close", (details: { reason?: string }) => {
        if (details.reason === "userCanceled") this.release(id);
      });
      notification.show();
      report("api-returned");
      return true;
    } catch {
      settled = true;
      report("failed");
      this.release(id);
      return false;
    }
  }
  private release(id: string): void {
    const entry = this.active.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.notification.removeAllListeners();
    this.active.delete(id);
  }
  dispose(): void {
    for (const id of this.active.keys()) this.release(id);
  }
}
