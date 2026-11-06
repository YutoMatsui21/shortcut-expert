import assert from "node:assert/strict";
import type { EventEmitter } from "node:events";
import { setTimeout } from "node:timers/promises";
import { app, BrowserWindow } from "electron";
import type { Snapshot } from "../shared/coach";
import { selectPage, waitForLearning } from "./learning-smoke";
import type { StandardNotifications } from "./standard-notification";

// OS notification delivery is replaced at the boundary; all window, IPC, Core,
// helper lifecycle and SQLite behavior below belongs to the packaged app.
export async function runActivationSmoke({
  window,
  snapshot,
  command,
  activate,
  failed,
  stopped,
  background,
  notifications,
  notificationEvents,
}: {
  window: BrowserWindow;
  snapshot(): Snapshot;
  command(value: string): Promise<Snapshot>;
  activate(): void;
  failed: boolean;
  stopped: boolean;
  background: boolean;
  notifications: StandardNotifications;
  notificationEvents: EventEmitter[];
}) {
  await waitForLearning(
    window,
    `document.querySelector('nav button[aria-label="ショートカット一覧"]')?.getAttribute('aria-current') === 'page'`,
  );
  const waitForWindow = async () => {
    const deadline = performance.now() + 3000;
    while (
      (!window.isVisible() || window.isMinimized()) &&
      performance.now() < deadline
    )
      await setTimeout(25);
    assert.equal(window.isVisible(), true);
    assert.equal(window.isMinimized(), false);
  };
  if (background) {
    assert.equal(
      window.isVisible(),
      false,
      "sign-in startup does not display the window",
    );
    app.emit("second-instance", {}, ["--login-startup"], "");
    assert.equal(
      window.isVisible(),
      false,
      "duplicate sign-in entry stays hidden",
    );
    app.emit("second-instance", {}, [], "");
  }
  await waitForWindow();
  assert.equal(
    window.isVisible(),
    true,
    "cold activation displays the list even when opened was saved",
  );
  if (failed) {
    assert.equal(snapshot().observing, false);
    assert.ok(snapshot().error);
    await waitForLearning(
      window,
      `!!document.querySelector('.save-error-banner')`,
    );
    activate();
    app.emit("second-instance", {}, [], "");
    assert.equal(
      snapshot().observing,
      false,
      "activation cannot erase initialization errors",
    );
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    return { activationInitializationFailure: true };
  }
  assert.equal(snapshot().settings.opened, true);
  assert.equal(
    snapshot().observing,
    !stopped,
    "cold initialization respects saved measurement permission",
  );
  assert.equal(
    snapshot().notificationsPaused,
    false,
    "notification pause remains session-only",
  );
  if (stopped) {
    assert.equal(snapshot().settings.recordingEnabled, false);
    await command("start");
    assert.equal(snapshot().observing, true);
  }
  await selectPage(window, "記録");
  await command("pause-notifications");
  await command("stop");
  const before = snapshot();
  await notifications.show({
    operation: "W03",
    shortcut: "Win + ↑",
    label: "ウィンドウを最大化する",
  });
  window.hide();
  notificationEvents.at(-1)!.emit("click");
  await waitForWindow();
  assert.equal(window.isVisible(), true);
  window.minimize();
  activate();
  app.emit("second-instance", {}, [], "");
  activate();
  await waitForWindow();
  assert.equal(window.isMinimized(), false);
  assert.equal(window.isVisible(), true);
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  assert.equal(snapshot().observing, false);
  assert.equal(snapshot().notificationsPaused, true);
  assert.deepEqual(snapshot().counts, before.counts);
  assert.deepEqual(snapshot().settings, before.settings);
  await waitForLearning(
    window,
    `document.querySelector('nav button[aria-label="記録"]')?.getAttribute('aria-current') === 'page'`,
  );
  // The next process must retain measurement stop, while resetting notification pause.
  if (background && stopped) await command("start"); // Next boot covers background startup with permission enabled.
  return {
    activationColdOpened: true,
    activationExistingWindow: true,
    activationPreservesStopPause: true,
    savedMeasurementStop: stopped,
    backgroundStartup: background,
  };
}
