import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { deferred } from "../support/fixtures.ts";
import type { Snapshot } from "../../src/shared/coach.ts";

let readNext: () => Promise<string>;
let lastStatus: { results: { valid: boolean }[] };
mock.module("node:fs/promises", {
  namedExports: {
    readFile: () => readNext(),
    writeFile: async (_path: string, text: string) => {
      lastStatus = JSON.parse(text);
    },
    rename: async () => {},
  },
});
const { runNaturalInputAcceptance } =
  await import("../../src/main/natural-input-acceptance.ts");

test("blocked file reads cannot allow late FINISH or cancel the session shutdown retry", async (t) => {
  for (const sessionExpiry of [false, true]) {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const heldRead = deferred<string>();
    let reads = 0,
      quit = 0;
    const snapshot: Snapshot = {
      counts: {},
      settings: { muted: [], opened: true, states: { W08: "learning" } },
      observing: false,
      notificationsPaused: false,
      error: null,
      pendingSave: false,
    };
    readNext = async () =>
      ++reads === 1
        ? JSON.stringify({
            sequence: 1,
            action: "arm",
            plan: {
              kind: "negative",
              application: "standard",
              state: "learning",
              paused: false,
            },
          })
        : heldRead.promise;
    const controller = runNaturalInputAcceptance(
      "isolated-fixture",
      {
        snapshot: () => snapshot,
        configure: async () => {},
        idle: async () => {},
        start: async () => {
          snapshot.observing = true;
        },
        stop: async () => {
          snapshot.observing = false;
        },
      },
      async () => {
        quit++;
      },
    );
    await setImmediate();
    t.mock.timers.tick(150);
    await setImmediate();
    assert.equal(snapshot.observing, true);
    t.mock.timers.tick(150);
    await setImmediate(); // hold an actual coordinator read across expiration
    t.mock.timers.tick(sessionExpiry ? 20 * 60_000 : 45_000);
    await setImmediate();
    assert.equal(
      snapshot.observing,
      false,
      "deadline stops observation despite stalled file I/O",
    );
    heldRead.resolve(JSON.stringify({ sequence: 2, action: "finish" }));
    await setImmediate();
    t.mock.timers.tick(100);
    await setImmediate();
    assert.equal(
      lastStatus.results[0].valid,
      false,
      "late FINISH remains invalid",
    );
    assert.equal(
      quit,
      sessionExpiry ? 1 : 0,
      "late FINISH cannot cancel mandatory session shutdown",
    );
    controller.dispose();
    t.mock.timers.reset();
  }
});

test("W01 source-selection countdown never starts hooks after END or session expiry", async (t) => {
  for (const reason of ["end", "expiry"]) {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    let start = 0;
    const snapshot: Snapshot = {
      counts: {},
      settings: { muted: [], opened: true, states: { W01: "learning" } },
      observing: false,
      notificationsPaused: false,
      error: null,
      pendingSave: false,
    };
    const arm = {
      sequence: 1,
      action: "arm",
      plan: {
        kind: "mouse",
        scenario: "direct",
        application: "standard",
        state: "learning",
        paused: false,
      },
    };
    let command: object = arm;
    readNext = async () => JSON.stringify(command);
    const controller = runNaturalInputAcceptance(
      "isolated-fixture",
      {
        snapshot: () => snapshot,
        configure: async () => {},
        idle: async () => {},
        start: async () => {
          start++;
          snapshot.observing = true;
        },
        stop: async () => {
          snapshot.observing = false;
        },
      },
      async () => {},
      "W01",
    );
    await setImmediate();
    t.mock.timers.tick(150);
    await setImmediate();
    assert.equal(start, 0);
    if (reason === "end") command = { sequence: 2, action: "end" };
    t.mock.timers.tick(reason === "end" ? 4000 : 20 * 60_000);
    await setImmediate();
    assert.equal(start, 0, reason);
    assert.equal(snapshot.observing, false);
    controller.dispose();
    t.mock.timers.reset();
  }
});
