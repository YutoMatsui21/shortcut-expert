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
const fromMonitor = { x: -1920, y: 0, width: 1920, height: 1080 };
const toMonitor = { x: 0, y: 0, width: 1920, height: 1080 };
function input(terminal = "maximized") {
  return {
    type: "candidate",
    protocolVersion: 2,
    generation: 1,
    sequence: 1,
    transaction: 1,
    date: today,
    origin: "mouse",
    route: "compound-caption-drag",
    injected: false,
    conflicted: false,
    evidence: {
      kind: "compound-drag",
      profile: "compound-drag-v1",
      terminal,
      targetMatched: true,
      released: true,
      layoutStable: true,
      inputAgeMs: 100,
      fromMonitor,
      toMonitor,
      moveDirection: "right",
      terminalEquivalent: true,
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
for (const terminal of ["maximized", "left-top", "right-bottom"])
  test(`compound ${terminal}: strict parse → real SQLite → one Toast → read models`, async (t) => {
    const h = await harness(t),
      candidate = candidateV2(input(terminal));
    assert.ok(candidate, "compound evidence must parse");
    const revision = h.coach.snapshot().revision!;
    await h.coach.accept(candidate);
    const operation = terminal === "maximized" ? "W03" : "W07";
    const saved = await h.repository.query(today, today);
    assert.deepEqual(saved.counts[today], {
      W02: { mouse: 1, key: 0 },
      [operation]: { mouse: 1, key: 0 },
    });
    assert.equal(saved.revision, revision + 1, "one atomic write/revision");
    assert.equal(h.requests.length, 1);
    assert.match(h.requests[0].body!, /別画面に移動する.*Win \+ Shift \+ →/);
    assert.match(
      h.requests[0].body!,
      terminal === "maximized" ? /最大化.*Win \+ ↑/ : /四隅.*Winを押したまま/,
    );
    assert.equal(h.requests[0].silent, true);
    await h.coach.accept({ ...candidate, sequence: 2 });
    assert.equal(h.requests.length, 1, "duplicate transaction cannot notify");
    assert.deepEqual(
      (await h.repository.query(today, today)).counts,
      saved.counts,
    );
    for (const model of [
      await h.coach.getLearning(today),
      await h.coach.getRecordSummary(today),
    ])
      for (const id of ["W02", operation])
        assert.equal(model.rows.find((row) => row.id === id)?.mouse, 1);
    await h.coach.accept({ ...candidate, sequence: 3, transaction: 2 });
    assert.equal(
      h.requests.length,
      2,
      "independent gestures remain separate Toasts",
    );
  });

test("compound parse fails closed and projects only allowlisted evidence", () => {
  const sample = input();
  assert.deepEqual(
    candidateV2({
      ...sample,
      hwnd: "private",
      evidence: { ...sample.evidence, title: "private" },
    }),
    sample,
  );
  for (const field of Object.keys(sample.evidence)) {
    const evidence: Record<string, unknown> = { ...sample.evidence };
    delete evidence[field];
    assert.equal(candidateV2({ ...sample, evidence }), null, field);
  }
  for (const patch of [
    { terminal: "left-half" },
    { inputAgeMs: NaN },
    { moveDirection: "up" },
    { fromMonitor: null },
    { terminalEquivalent: null },
    { released: 1 },
    { profile: "future" },
  ])
    assert.equal(
      candidateV2({ ...sample, evidence: { ...sample.evidence, ...patch } }),
      null,
    );
});

for (const terminal of ["maximized", "right-bottom"])
  for (const mode of [
    "unknown-direction",
    "terminal-key-unknown",
    "W02-mastered",
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
        operation = terminal === "maximized" ? "W03" : "W07";
      if (mode === "os-unknown") t.mock.timers.enable({ apis: ["setTimeout"] });
      if (mode === "unknown-direction")
        Object.assign(raw.evidence, { moveDirection: null });
      if (mode === "terminal-key-unknown")
        raw.evidence.terminalEquivalent = false;
      if (mode === "W02-mastered" || mode === "none")
        await h.coach.setLearningState("W02", "mastered");
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
          ? h.coach.setLearningState("W02", "mastered")
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
        W02: { mouse: 1, key: 0 },
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
      if (
        ["unknown-direction", "W02-mastered", "state-during-save"].includes(
          mode,
        )
      )
        assert.equal(
          h.requests[0].title,
          terminal === "maximized" ? "Win + ↑" : "Winを押したまま →、続けて ↓",
        );
      if (["terminal-key-unknown", "terminal-excluded"].includes(mode))
        assert.equal(h.requests[0].title, "Win + Shift + →");
      await h.coach.accept({ ...candidate, sequence: 2 });
      assert.equal(h.requests.length, suppressed ? 0 : 1);
    });

test("invalid compound evidence never partially classifies", () => {
  const sample = input();
  for (const patch of [
    { targetMatched: false },
    { released: false },
    { layoutStable: false },
    { inputAgeMs: 1001 },
    { toMonitor: fromMonitor },
  ]) {
    const parsed = candidateV2({
      ...sample,
      evidence: { ...sample.evidence, ...patch },
    });
    assert.ok(parsed);
    assert.deepEqual(classifyGesture(parsed), []);
  }
  for (const patch of [
    { origin: "key" },
    { injected: true },
    { conflicted: true },
    { route: "caption-drag" },
  ]) {
    const parsed = candidateV2({ ...sample, ...patch });
    assert.ok(parsed);
    assert.deepEqual(classifyGesture(parsed), []);
  }
});

for (const terminal of ["maximized", "right-bottom"])
  test(`compound ${terminal}: second count failure rolls back both counts and checkpoint`, async (t) => {
    const h = await harness(t),
      operation = terminal === "maximized" ? "W03" : "W07";
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
        W02: { mouse: 1, key: 0 },
        [operation]: { mouse: 1, key: 0 },
      });
      assert.equal(h.requests.length, 0, "recovery never delivers old notices");
    } finally {
      db.close();
    }
  });

for (const terminal of ["maximized", "left-top"])
  test(`two-display vertical compound ${terminal} includes both operation lines`, async (t) => {
    const h = await harness(t);
    const raw = input(terminal);
    Object.assign(raw.evidence, {
      moveDirection: null,
      twoDisplayLayoutConfirmed: true,
      toMonitor: { x: -1920, y: -1440, width: 2560, height: 1440 },
    });
    const candidate = candidateV2(raw);
    assert.ok(candidate);
    const observations = classifyGesture(candidate);
    assert.equal(observations[0].shortcut, "Win + Shift + ←");
    await h.coach.accept(candidate);
    assert.equal(h.requests.length, 1);
    assert.match(h.requests[0].body!, /別画面に移動する.*Win \+ Shift \+ ←/);
    assert.match(
      h.requests[0].body!,
      terminal === "maximized" ? /最大化.*Win \+ ↑/ : /四隅.*Winを押したまま/,
    );
    for (const proof of [false, undefined]) {
      Object.assign(raw.evidence, { twoDisplayLayoutConfirmed: proof });
      if (proof === undefined)
        delete (raw.evidence as Record<string, unknown>)
          .twoDisplayLayoutConfirmed;
      assert.equal(classifyGesture(candidateV2(raw)!)[0].shortcut, null);
    }
    Object.assign(raw.evidence, {
      twoDisplayLayoutConfirmed: true,
      toMonitor: { ...fromMonitor, y: -100 },
    });
    assert.equal(
      classifyGesture(candidateV2(raw)!)[0].shortcut,
      null,
      "overlapping monitors cannot prove a unique destination",
    );
    for (const proof of [null, 1, "true"]) {
      Object.assign(raw.evidence, { twoDisplayLayoutConfirmed: proof });
      assert.equal(candidateV2(raw), null, "new evidence must be a boolean");
    }
  });

for (const terminal of ["maximized", "left-top"])
  for (const moveState of ["learning", "mastered", "excluded"] as const)
    for (const terminalState of ["learning", "mastered", "excluded"] as const)
      test(`compound state matrix ${terminal}: W02=${moveState}, terminal=${terminalState}`, async (t) => {
        const h = await harness(t),
          operation = terminal === "maximized" ? "W03" : "W07";
        await h.coach.setLearningState("W02", moveState);
        await h.coach.setLearningState(operation, terminalState);
        const raw = input(terminal);
        Object.assign(raw.evidence, {
          moveDirection: null,
          twoDisplayLayoutConfirmed: true,
          toMonitor: { x: -1920, y: -1440, width: 2560, height: 1440 },
        });
        const candidate = candidateV2(raw);
        assert.ok(candidate);
        const revision = h.coach.snapshot().revision!;
        await h.coach.accept(candidate);
        const saved = await h.repository.query(today, today);
        assert.deepEqual(saved.counts[today], {
          W02: { mouse: 1, key: 0 },
          [operation]: { mouse: 1, key: 0 },
        });
        assert.equal(
          saved.revision,
          revision + 1,
          "all learning states retain both counts atomically",
        );
        const expectedKeys = [
          moveState === "learning" ? "Win + Shift + ←" : null,
          terminalState === "learning"
            ? terminal === "maximized"
              ? "Win + ↑"
              : "Winを押したまま ←、続けて ↑"
            : null,
        ].filter((key): key is string => key !== null);
        assert.equal(h.requests.length, expectedKeys.length ? 1 : 0);
        if (expectedKeys.length === 1)
          assert.equal(h.requests[0].title, expectedKeys[0]);
        if (expectedKeys.length === 2)
          for (const key of expectedKeys)
            assert.ok(h.requests[0].body!.includes(key));
        for (const [id, state] of [
          ["W02", moveState],
          [operation, terminalState],
        ]) {
          const row = (await h.coach.getLearning(today)).rows.find(
            (r) => r.id === id,
          )!;
          assert.equal(row.state, state);
          assert.equal(row.mouse, 1);
        }
        await h.coach.accept({ ...candidate, sequence: 2 });
        assert.equal(
          h.requests.length,
          expectedKeys.length ? 1 : 0,
          "duplicate transaction never re-notifies",
        );
        const replayed = await h.repository.query(today, today);
        assert.deepEqual(replayed.counts, saved.counts);
        assert.equal(replayed.revision, saved.revision);
      });
