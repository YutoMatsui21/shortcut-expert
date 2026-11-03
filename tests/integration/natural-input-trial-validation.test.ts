import { test } from "node:test";
import assert from "node:assert/strict";
import type { Snapshot } from "../../src/shared/coach.ts";
import { FinalInputTrials } from "../../src/main/final-input-trials.ts";
import { learningOperations } from "../../src/shared/learning.ts";
import {
  windowDiagnosticKeys,
  type WindowDiagnosticCounts,
} from "../../src/shared/window-diagnostics.ts";

function harness() {
  const snapshot: Snapshot = {
    counts: {},
    settings: { muted: [], opened: true },
    observing: false,
    notificationsPaused: false,
    error: null,
    pendingSave: false,
  };
  let now = 0,
    starts = 0,
    date = "2026-10-30";
  const trials = new FinalInputTrials({
    snapshot: () => snapshot,
    now: () => now,
    date: () => date,
    idle: async () => {},
    configure: async (states) => {
      snapshot.settings.states = states;
    },
    start: async (paused) => {
      starts++;
      snapshot.observing = true;
      snapshot.notificationsPaused = paused;
    },
    stop: async () => {
      snapshot.observing = false;
    },
  });
  return {
    trials,
    snapshot,
    time: (value: number) => {
      now = value;
    },
    day: (value: string) => {
      date = value;
    },
    starts: () => starts,
  };
}
const plan = {
  caseId: "C03-right",
  application: "standard",
  state: "learning",
  secondaryState: "learning",
  paused: false,
  stopped: false,
  slot: 1,
};
const confirmation = {
  result: "matched",
  notification: "matched",
  equivalence: "not-tested",
};

test("native counters are copied into the active trial without changing its acceptance result", async () => {
  const h = harness();
  await h.trials.arm({ ...plan, caseId: "N08" });
  const counts = Object.fromEntries(
    windowDiagnosticKeys.map((key) => [key, 0]),
  ) as WindowDiagnosticCounts;
  counts.RawClient = 2;
  h.trials.nativeDiagnostics(counts);
  counts.RawClient = 5;
  await h.trials.finish(true, confirmation);
  assert.equal(h.trials.results[0].nativeDiagnostics?.RawClient, 2);
  assert.equal(h.trials.results[0].recordsPassed, true);
  h.trials.nativeDiagnostics(counts);
  assert.equal(h.trials.results[0].nativeDiagnostics?.RawClient, 2);
  await h.trials.arm({ ...plan, caseId: "N08", stopped: true });
  h.trials.nativeDiagnostics(counts);
  await h.trials.finish(true, confirmation);
  assert.equal(
    h.trials.results[1].nativeDiagnostics,
    null,
    "a stopped trial cannot inherit counters from any observed generation",
  );
});

test("W12 validates the candidate slot even without a notification; midnight invalidates the trial", async () => {
  const { taskbarFixture } = await import("../support/fixtures.ts");
  for (const kind of ["key", "mouse"] as const) {
    const h = harness();
    await h.trials.arm({
      ...plan,
      caseId: kind === "key" ? "P12k" : "P12m",
      slot: 10,
      state: "excluded",
    });
    h.trials.candidate(taskbarFixture(kind, 1, 1));
    h.snapshot.counts["2026-10-30"] = {
      W12: { mouse: kind === "mouse" ? 1 : 0, key: kind === "key" ? 1 : 0 },
    };
    await h.trials.finish(true, confirmation);
    assert.equal(h.trials.results[0].slotMatched, false);
    assert.equal(h.trials.results[0].recordsPassed, false);
    const good = harness();
    await good.trials.arm({
      ...plan,
      caseId: kind === "key" ? "P12k" : "P12m",
      slot: 10,
      state: "excluded",
    });
    good.trials.candidate(taskbarFixture(kind, 1, 10));
    good.snapshot.counts["2026-10-30"] = {
      W12: { mouse: kind === "mouse" ? 1 : 0, key: kind === "key" ? 1 : 0 },
    };
    await good.trials.finish(true, confirmation);
    assert.equal(good.trials.results[0].slotMatched, true);
    assert.equal(good.trials.results[0].recordsPassed, true);
  }
  const h = harness();
  await h.trials.arm({ ...plan, caseId: "P03k" });
  h.day("2026-10-31");
  h.snapshot.counts["2026-10-31"] = { W03: { mouse: 0, key: 1 } };
  await h.trials.finish(true, confirmation);
  assert.equal(h.trials.results[0].dateChanged, true);
  assert.equal(h.trials.results[0].valid, false);
});

test("final trial checks all operations, daily persistence and a single compound notification independently", async () => {
  const h = harness();
  await h.trials.arm(plan);
  h.snapshot.counts["2026-10-30"] = {
    W02: { mouse: 1, key: 0 },
    W03: { mouse: 1, key: 0 },
  };
  h.trials.noticeRequested("W02", "Win + Shift + →", [
    { operation: "W02", label: "", shortcut: "Win + Shift + →" },
    { operation: "W03", label: "", shortcut: "Win + ↑" },
  ]);
  await h.trials.finish(true, confirmation);
  const result = h.trials.results[0];
  assert.equal(result.valid, true);
  assert.equal(result.recordsPassed, true);
  assert.equal(result.notificationRequestPassed, true);
  assert.equal(result.notificationRequests, 1);
  assert.equal(result.equivalence, "not-tested");
  assert.equal(h.snapshot.observing, false);
  await h.trials.arm(plan);
  h.snapshot.counts["2026-10-30"].W02!.mouse++;
  h.snapshot.counts["2026-10-30"].W03!.mouse++;
  h.snapshot.counts["2026-10-30"].W04 = { mouse: 1, key: 0 };
  h.trials.noticeRequested("W02", "Win + Shift + →");
  h.trials.noticeRequested("W03", "Win + ↑");
  await h.trials.finish(true, confirmation);
  assert.equal(
    h.trials.results[1].recordsPassed,
    false,
    "derived W04 must not hide behind matching primary deltas",
  );
  assert.equal(
    h.trials.results[1].notificationRequestPassed,
    false,
    "two Toast requests cannot pass as one compound",
  );
});

test("compound mixed learning states retain two records and only eligible notification lines", async () => {
  for (const state of ["learning", "mastered", "excluded"] as const)
    for (const secondaryState of [
      "learning",
      "mastered",
      "excluded",
    ] as const) {
      const h = harness();
      await h.trials.arm({ ...plan, state, secondaryState });
      h.snapshot.counts["2026-10-30"] = {
        W02: { mouse: 1, key: 0 },
        W03: { mouse: 1, key: 0 },
      };
      const items = [
        {
          operation: "W02" as const,
          label: "",
          shortcut: "Win + Shift + →",
          state,
        },
        {
          operation: "W03" as const,
          label: "",
          shortcut: "Win + ↑",
          state: secondaryState,
        },
      ].filter((item) => item.state === "learning");
      if (items.length)
        h.trials.noticeRequested(items[0].operation, items[0].shortcut, items);
      await h.trials.finish(true, confirmation);
      assert.equal(h.trials.results[0].recordsPassed, true);
      assert.equal(h.trials.results[0].notificationRequestPassed, true);
    }
});

test("final trial fails closed for arbitrary metadata, wrong day, timeout, interruption, cancelled and unconfirmed trials", async () => {
  const invalid = harness();
  for (const value of [
    { ...plan, caseId: "private title" },
    { ...plan, application: "private path" },
    { ...plan, slot: 11 },
    { ...plan, extra: "private text" },
  ])
    await assert.rejects(invalid.trials.arm(value));
  assert.equal(invalid.starts(), 0);
  for (const scenario of ["day", "timeout", "fault", "cancel", "unconfirmed"]) {
    const h = harness();
    await h.trials.arm({ ...plan, caseId: "P03k" });
    h.snapshot.counts[scenario === "day" ? "2026-10-29" : "2026-10-30"] = {
      W03: { mouse: 0, key: 1 },
    };
    if (scenario === "timeout") h.time(45_000);
    if (scenario === "fault") {
      h.trials.observe({ ...h.snapshot, error: "fixture", observing: false });
      h.trials.observe(h.snapshot);
    }
    await h.trials.finish(
      scenario !== "cancel",
      scenario === "unconfirmed" ? undefined : confirmation,
    );
    const result = h.trials.results[0];
    if (scenario === "day") assert.equal(result.recordsPassed, false);
    else assert.equal(result.valid, false);
    assert.equal(h.snapshot.observing, false);
  }
});

test("pause, stop and negative trials cannot issue notices or hide excluded-operation counts", async () => {
  for (const variant of [
    { caseId: "P03m", paused: true },
    { caseId: "P03m", stopped: true },
    { caseId: "N08" },
  ]) {
    const h = harness();
    await h.trials.arm({ ...plan, ...variant });
    if ("paused" in variant)
      h.snapshot.counts["2026-10-30"] = { W03: { mouse: 1, key: 0 } };
    await h.trials.finish(true, confirmation);
    assert.equal(h.trials.results[0].recordsPassed, true);
    assert.equal(h.trials.results[0].notificationRequestPassed, true);
    assert.equal(
      learningOperations.every((op) => h.snapshot.settings.states?.[op.id]),
      true,
    );
    const second = harness();
    await second.trials.arm({ ...plan, ...variant });
    second.snapshot.counts["2026-10-30"] = { W08: { mouse: 1, key: 0 } };
    second.trials.noticeRequested("W03", "Win + ↑");
    await second.trials.finish(true, confirmation);
    assert.equal(second.trials.results[0].recordsPassed, false);
    assert.equal(second.trials.results[0].notificationRequestPassed, false);
  }
});
