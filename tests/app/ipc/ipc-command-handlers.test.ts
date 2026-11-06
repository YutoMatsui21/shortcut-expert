import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test, mock } from "node:test";
import type { CoachBridge, Snapshot } from "../../../src/shared/coach.ts";

type Handler = (
  event: Electron.IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown;
const handlers = new Map<string, Handler>();
mock.module("electron", {
  namedExports: {
    ipcMain: {
      handle: (channel: string, handler: Handler) => {
        assert.equal(handlers.has(channel), false);
        handlers.set(channel, handler);
      },
    },
  },
});
const { registerCoachIpc } = await import("../../../src/main/coach-ipc.ts");

test("正規の要求だけ実行し、別窓・子frame・不正な引数を副作用の前に拒否する", async () => {
  // Only Electron's identity boundary is faked; registration and validation are production code.
  const mainFrame = {};
  const contents = Object.assign(new EventEmitter(), { id: 1, mainFrame });
  const notice = { id: 2, mainFrame: {} };
  const event = {
    sender: contents,
    senderFrame: mainFrame,
  } as Electron.IpcMainInvokeEvent;
  const noticeEvent = {
    sender: notice,
    senderFrame: notice.mainFrame,
  } as Electron.IpcMainInvokeEvent;
  const snapshot: Snapshot = {
    counts: {},
    settings: { muted: [], opened: true },
    observing: true,
    notificationsPaused: false,
    error: null,
    pendingSave: false,
  };
  const requests = {
    getRecordSummary: mock.fn(async () => ({
      query: {
        period: 7 as const,
        filter: "learning-mastered" as const,
        sort: "rate" as const,
      },
      priorFrom: "2026-10-06",
      priorTo: "2026-10-12",
      previous: {
        mouse: null,
        key: null,
        total: null,
        rate: null,
        barRate: null,
      },
      comparison: {
        mouse: null,
        key: null,
        total: null,
        improvement: null,
        hasMissingCoverage: true,
      },
      from: "2026-10-13",
      to: "2026-10-19",
      revision: 0,
      rows: [],
      summary: {
        mouse: null,
        key: null,
        total: null,
        rate: null,
        barRate: null,
      },
    })),
    getLearning: mock.fn(async () => ({
      from: "2026-10-13",
      to: "2026-10-19",
      revision: 0,
      rows: [],
    })),
    windowCommand: mock.fn(async () => {}),
    getRecords: mock.fn(async () => ({
      counts: {},
      coverage: {},
      revision: 0,
    })),
    getSnapshot: mock.fn(async () => snapshot),
    command: mock.fn<CoachBridge["command"]>(async () => snapshot),
    setLearningState: mock.fn<CoachBridge["setLearningState"]>(
      async () => snapshot,
    ),
    deleteCounts: mock.fn(async () => snapshot),
  };
  const window = Object.assign(new EventEmitter(), {
    webContents: contents,
  }) as Electron.BrowserWindow;
  registerCoachIpc(() => window, requests);
  assert.equal(handlers.has("coach:get-notice"), false);
  assert.equal(handlers.has("coach:set-muted"), false);
  assert.equal(handlers.size, 10);
  const invoke = (
    channel: string,
    from: Electron.IpcMainInvokeEvent,
    ...args: unknown[]
  ) => handlers.get(channel)!(from, ...args);
  for (const channel of handlers.keys()) {
    if (channel === "coach:delete" || channel === "coach:cancel-delete")
      continue;
    const sender = event;
    const args =
      channel === "coach:set-learning-state"
        ? ["W04", "mastered"]
        : channel === "coach:window"
          ? ["hide"]
          : channel === "coach:command"
            ? ["stop"]
            : channel === "coach:get-records"
              ? ["2026-10-01", "2026-10-19"]
              : [];
    assert.throws(
      () =>
        invoke(
          channel,
          { ...sender, senderFrame: {} } as Electron.IpcMainInvokeEvent,
          ...args,
        ),
      /Unknown sender/,
    );
    assert.throws(
      () => invoke(channel, noticeEvent, ...args),
      /Unknown sender/,
    );
    await invoke(channel, sender, ...args);
  }
  for (const channel of ["coach:delete", "coach:cancel-delete"]) {
    for (const invalid of [undefined, null, {}, true, "", "fake"])
      assert.throws(() => invoke(channel, event, invalid), /confirmation/);
    assert.throws(
      () =>
        invoke(channel, noticeEvent, "00000000-0000-0000-0000-000000000000"),
      /Unknown sender/,
    );
    assert.throws(
      () =>
        invoke(
          channel,
          { ...event, senderFrame: {} } as Electron.IpcMainInvokeEvent,
          "00000000-0000-0000-0000-000000000000",
        ),
      /Unknown sender/,
    );
  }
  const cancelled = await invoke("coach:request-delete", event);
  await invoke("coach:cancel-delete", event, cancelled);
  assert.throws(() => invoke("coach:delete", event, cancelled), /confirmation/);
  const token = await invoke("coach:request-delete", event);
  await invoke("coach:delete", event, token);
  assert.throws(() => invoke("coach:delete", event, token), /confirmation/);
  assert.equal(requests.deleteCounts.mock.callCount(), 1);
  const hidden = await invoke("coach:request-delete", event);
  window.emit("hide");
  assert.throws(() => invoke("coach:delete", event, hidden), /confirmation/);
  for (const value of [null, {}, "unknown", 1])
    assert.throws(
      () => invoke("coach:command", event, value),
      /Unknown command/,
    );
  for (const value of [null, {}, "quit", 1])
    assert.throws(
      () => invoke("coach:window", event, value),
      /Unknown window command/,
    );
  assert.equal(requests.windowCommand.mock.callCount(), 1);
  assert.equal(requests.getLearning.mock.callCount(), 1);
  assert.equal(requests.getRecordSummary.mock.callCount(), 1);
  for (const value of [
    null,
    [],
    {},
    { period: 60, filter: "all", sort: "rate" },
    { period: 30, filter: "excluded", sort: "rate" },
    { period: 30, filter: "all", sort: "unknown" },
    { period: 30, filter: "all", sort: "rate", sql: "SELECT *" },
  ]) {
    assert.throws(
      () => invoke("coach:get-record-summary", event, value),
      /Invalid records query/,
    );
  }
  await invoke("coach:get-record-summary", event, {
    period: 30,
    filter: "all",
    sort: "improvement",
  });
  assert.equal(requests.getRecordSummary.mock.callCount(), 2);
  assert.deepEqual(requests.getRecordSummary.mock.calls.at(-1)?.arguments, [
    { period: 30, filter: "all", sort: "improvement" },
  ]);
  for (const args of [
    [null, "2026-10-19"],
    ["2026-02-30", "2026-03-01"],
    ["2020-01-01", "2026-10-19"],
    ["2026-10-19", "2026-10-01"],
  ]) {
    assert.throws(
      () => invoke("coach:get-records", event, ...args),
      /Invalid range/,
    );
  }
  assert.equal(requests.command.mock.callCount(), 1);
  for (const args of [
    ["W09", "learning"],
    ["W14", "excluded"],
    ["W99", "learning"],
    ["W03", "automatic"],
    ["W03", {}],
    [null, "learning"],
  ]) {
    assert.throws(
      () => invoke("coach:set-learning-state", event, ...args),
      /Invalid learning state/,
    );
  }
  assert.deepEqual(requests.setLearningState.mock.calls[0].arguments, [
    "W04",
    "mastered",
  ]);
  assert.equal(requests.setLearningState.mock.callCount(), 1);
  assert.deepEqual(requests.command.mock.calls[0].arguments, ["stop"]);
  await invoke("coach:command", event, "enable-startup");
  await invoke("coach:command", event, "disable-startup");
  assert.deepEqual(
    requests.command.mock.calls.slice(-2).map((call) => call.arguments),
    [["enable-startup"], ["disable-startup"]],
  );
});
