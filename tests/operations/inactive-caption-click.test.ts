import { test, mock, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EventEmitter } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { DurableCoach } from "../../src/core/durable-coach.ts";
import { SqliteRepository } from "../../src/main/sqlite-repository.ts";
import { classifyGesture } from "../../src/core/detector.ts";
mock.module("electron", { namedExports: { app: {}, Notification: class {} } });
const { candidateV2 } = await import("../../src/main/observer.ts");
const { StandardNotifications } =
  await import("../../src/main/standard-notification.ts");
const today = "2026-10-29";
const toMonitor = { x: 0, y: 0, width: 1920, height: 1080 };
function input(terminal: string | null = "maximized", switched = true) {
  return {
    type: "candidate",
    protocolVersion: 2,
    generation: 1,
    sequence: 1,
    transaction: 1,
    date: today,
    origin: "mouse",
    route: "inactive-caption-click",
    injected: false,
    conflicted: false,
    evidence: {
      kind: "caption-click",
      profile: "caption-click-v1",
      terminal,
      switched,
      targetMatched: true,
      released: true,
      inputAgeMs: 250,
      monitor: toMonitor,
    },
  };
}
async function harness(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "coach-compound-"));
  const repository = new SqliteRepository(
    root,
    resolve("src/main/storage-worker.ts"),
  );
  t.after(async () => {
    await repository.close();
    await rm(root, { recursive: true, force: true });
  });
  const requests: Electron.NotificationConstructorOptions[] = [];
  const results: string[] = [];
  const adapter = new StandardNotifications(
    () => {},
    (result) => results.push(result.status),
    (options) => {
      requests.push(options);
      return Object.assign(new EventEmitter(), { show() {} });
    },
  );
  t.after(() => adapter.dispose());
  const coach = new DurableCoach({
    repository,
    session: repository.session,
    date: () => today,
    now: () => 0,
    capabilities: () => [],
    changed: () => {},
    notify: (value) => adapter.show(value),
  });
  await coach.initialize();
  coach.begin(1);
  return { root, coach, repository, requests, results };
}
for (const terminal of ["maximized", "minimized"]) {
  test(`inactive caption ${terminal}: parse → atomic SQLite → single Toast and replay`, async (t) => {
    const h = await harness(t);
    const c = candidateV2(input(terminal));
    assert.ok(c);
    const revision = h.coach.snapshot().revision!;
    await h.coach.accept(c);
    const operation = terminal === "maximized" ? "W03" : "W04";
    const saved = await h.repository.query(today, today);
    assert.deepEqual(saved.counts[today], {
      W01: { mouse: 1, key: 0 },
      [operation]: { mouse: 1, key: 0 },
    });
    assert.equal(saved.revision, revision + 1);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].body!.split("\n").length, 2);
    assert.match(h.requests[0].body!, /Alt \+ Tab/);
    assert.ok(
      h.requests[0].body!.includes(
        terminal === "maximized" ? "Win + ↑" : "Win + ↓",
      ),
    );
    assert.ok(!h.requests[0].body!.includes("2回"));
    await h.coach.accept({ ...c, sequence: 2 });
    assert.deepEqual(
      (await h.repository.query(today, today)).counts,
      saved.counts,
    );
    assert.equal(h.requests.length, 1);
  });
  for (const state of ["both", "switch-only", "state-only", "none"]) {
    test(`caption ${terminal}: learning ${state} filters lines only`, async (t) => {
      const h = await harness(t);
      const operation = terminal === "maximized" ? "W03" : "W04";
      if (state === "state-only" || state === "none")
        await h.coach.setLearningState("W01", "mastered");
      if (state === "switch-only" || state === "none")
        await h.coach.setLearningState(operation, "excluded");
      const c = candidateV2(input(terminal));
      assert.ok(c);
      await h.coach.accept(c);
      assert.deepEqual((await h.repository.query(today, today)).counts[today], {
        W01: { mouse: 1, key: 0 },
        [operation]: { mouse: 1, key: 0 },
      });
      assert.equal(h.requests.length, state === "none" ? 0 : 1);
      if (state === "both")
        assert.equal(h.requests[0].body!.split("\n").length, 2);
      if (state === "switch-only")
        assert.equal(h.requests[0].title, "Alt + Tab");
      if (state === "state-only")
        assert.equal(
          h.requests[0].title,
          terminal === "maximized" ? "Win + ↑" : "Win + ↓",
        );
    });
  }
}
test("caption evidence fails closed and supports independently confirmed results", () => {
  for (const patch of [
    { injected: true },
    { conflicted: true },
    { origin: "key" },
    { route: "other" },
  ]) {
    const c = candidateV2({ ...input(), ...patch });
    assert.ok(c);
    assert.deepEqual(classifyGesture(c), []);
  }
  for (const patch of [
    { targetMatched: false },
    { released: false },
    { inputAgeMs: 501 },
    { inputAgeMs: -1 },
  ]) {
    const raw = input();
    Object.assign(raw.evidence, patch);
    const c = candidateV2(raw);
    assert.deepEqual(c ? classifyGesture(c) : [], []);
  }
  assert.equal(
    candidateV2({
      ...input(),
      evidence: { ...input().evidence, terminal: "restored" },
    }),
    null,
  );
  for (const [terminal, switched, ids] of [
    [null, true, ["W01"]],
    ["minimized", false, ["W04"]],
    [null, false, []],
  ] as const) {
    const c = candidateV2(input(terminal, switched));
    assert.ok(c);
    assert.deepEqual(
      classifyGesture(c).map((o) => o.operation),
      ids,
    );
  }
});

for (const terminal of ["maximized", "minimized"])
  for (const mode of [
    "W01-mastered",
    "terminal-excluded",
    "none",
    "pause",
    "stop",
    "failure",
    "ack-loss",
    "os-unknown",
    "state-during-save",
  ])
    test(`compound ${terminal} eligibility/fault: ${mode}`, async (t) => {
      const h = await harness(t),
        raw = input(terminal),
        operation = terminal === "maximized" ? "W03" : "W04";
      if (mode === "os-unknown") t.mock.timers.enable({ apis: ["setTimeout"] });
      if (mode === "W01-mastered" || mode === "none")
        await h.coach.setLearningState("W01", "mastered");
      if (mode === "terminal-excluded" || mode === "none")
        await h.coach.setLearningState(operation, "excluded");
      const commit = h.repository.commit.bind(h.repository);
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((r) => {
          release = r;
        }),
        ready = new Promise<void>((r) => {
          entered = r;
        });
      h.repository.commit = async (mutation) => {
        entered();
        await gate;
        if (mode === "failure") throw new Error("fixture disk failure");
        await commit(mutation);
        if (mode === "ack-loss") throw new Error("fixture ACK loss");
      };
      const candidate = candidateV2(raw);
      assert.ok(candidate);
      const writing = h.coach.accept(candidate);
      await ready;
      assert.equal(h.requests.length, 0, "never notify before persistence");
      if (mode === "pause") {
        h.coach.pauseNotifications(true);
        h.coach.pauseNotifications(false);
      }
      if (mode === "stop") h.coach.stop();
      const stateChange =
        mode === "state-during-save"
          ? h.coach.setLearningState("W01", "mastered")
          : Promise.resolve();
      release();
      await writing;
      await stateChange;
      if (mode === "os-unknown") {
        t.mock.timers.tick(60_000);
        assert.ok(h.results.includes("unknown"));
      }
      if (mode === "failure" || mode === "ack-loss") {
        assert.equal(h.coach.snapshot().pendingSave, true);
        h.repository.commit = commit;
        await h.coach.retrySave();
        await h.coach.retrySave();
      }
      assert.deepEqual((await h.repository.query(today, today)).counts[today], {
        W01: { mouse: 1, key: 0 },
        [operation]: { mouse: 1, key: 0 },
      });
      const suppressed = [
        "none",
        "pause",
        "stop",
        "failure",
        "ack-loss",
      ].includes(mode);
      assert.equal(h.requests.length, suppressed ? 0 : 1);
      if (["W01-mastered", "state-during-save"].includes(mode))
        assert.equal(
          h.requests[0].title,
          terminal === "maximized" ? "Win + ↑" : "Win + ↓",
        );
      if (mode === "terminal-excluded")
        assert.equal(h.requests[0].title, "Alt + Tab");
      await h.coach.accept({ ...candidate, sequence: 2 });
      assert.equal(h.requests.length, suppressed ? 0 : 1);
    });

for (const terminal of ["maximized", "minimized"])
  test(`compound ${terminal}: second count failure rolls back both counts and checkpoint`, async (t) => {
    const h = await harness(t),
      operation = terminal === "maximized" ? "W03" : "W04";
    const db = new DatabaseSync(join(h.root, "records-v1", "records.sqlite"));
    try {
      const before = await h.repository.query(today, today);
      db.exec(
        `CREATE TRIGGER fixture_failure BEFORE INSERT ON counts WHEN NEW.operation='${operation}' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END`,
      );
      const candidate = candidateV2(input(terminal));
      assert.ok(candidate);
      await h.coach.accept(candidate);
      assert.deepEqual(
        await h.repository.query(today, today),
        before,
        "counts, coverage, revision all roll back",
      );
      assert.equal(h.requests.length, 0);
      assert.equal(h.coach.snapshot().pendingSave, true);
      db.exec("DROP TRIGGER fixture_failure");
      await h.coach.retrySave();
      await h.coach.retrySave();
      assert.deepEqual((await h.repository.query(today, today)).counts[today], {
        W01: { mouse: 1, key: 0 },
        [operation]: { mouse: 1, key: 0 },
      });
      assert.equal(h.requests.length, 0, "recovery never delivers old notices");
    } finally {
      db.close();
    }
  });
