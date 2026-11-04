import type { MenuItemConstructorOptions } from "electron";
import type { CoachBridge, Snapshot } from "../shared/coach";

export function coachTrayMenu(
  snapshot: Snapshot,
  command: CoachBridge["command"],
  show: () => void,
  quit: () => Promise<void>,
): MenuItemConstructorOptions[] {
  return [
    { label: "記録を見る", click: show },
    {
      label: snapshot.notificationsPaused ? "通知を再開" : "通知を停止",
      enabled: snapshot.observing,
      click: () => {
        void command(
          snapshot.notificationsPaused
            ? "resume-notifications"
            : "pause-notifications",
        );
      },
    },
    {
      label: snapshot.observing ? "全停止" : "計測を再開",
      enabled: snapshot.observing || !snapshot.pendingSave,
      click: () => {
        void command(snapshot.observing ? "stop" : "start");
      },
    },
    { type: "separator" },
    {
      label: "終了",
      click: () => {
        void quit();
      },
    },
  ];
}
