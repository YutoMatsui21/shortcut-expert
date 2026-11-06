import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, mock } from "node:test";
import { classify } from "../../src/core/detector.ts";
import { DurableCoach } from "../../src/core/durable-coach.ts";
import { SqliteRepository } from "../../src/main/sqlite-repository.ts";
import { snapFixture, taskbarFixture } from "../support/fixtures.ts";
mock.module("electron", { namedExports: { app: {} } });
const { candidateV2 } = await import("../../src/main/observer.ts");

test("W08 strict schema, meaning, unknowns and negative evidence", () => {
  for (const origin of ["mouse", "key"] as const) {
    const fixture = snapFixture(origin);
    assert.deepEqual(candidateV2(fixture), fixture);
    assert.equal(classify(fixture), null);
    for (const extra of [
      { injected: true },
      { conflicted: true },
      { origin: "unknown" as const },
      { route: "win-up" },
      { date: "invalid" },
    ])
      assert.equal(classify({ ...fixture, ...extra }), null);
    for (const extra of [
      { eligible: false },
      { targetMatched: false },
      { settingsEnabled: null },
      { settingsEnabled: false },
      { inputAgeMs: 201 },
      { inputAgeMs: -1 },
      { inputAgeMs: NaN },
      ...(origin === "mouse"
        ? [{ dwellMs: 499 }, { buttonSource: null }]
        : [{ dwellMs: 500 }, { buttonSource: "title-rect" as const }]),
    ])
      assert.equal(
        classify({ ...fixture, evidence: { ...fixture.evidence, ...extra } }),
        null,
      );
    for (const field of [
      "eligible",
      "targetMatched",
      "settingsEnabled",
      "buttonSource",
      "dwellMs",
      "inputAgeMs",
      "monitor",
    ]) {
      const evidence: Record<string, unknown> = { ...fixture.evidence };
      delete evidence[field];
      assert.equal(candidateV2({ ...fixture, evidence }), null, field);
    }
    for (const extra of [
      { profile: "unverified" },
      { settingsEnabled: "true" },
      { buttonSource: "hit-only" },
      { dwellMs: Infinity },
      { monitor: {} },
    ])
      assert.equal(
        candidateV2({
          ...fixture,
          evidence: { ...fixture.evidence, ...extra },
        }),
        null,
      );
    assert.deepEqual(
      candidateV2({
        ...fixture,
        target: "private",
        evidence: { ...fixture.evidence, windowTitle: "private" },
      }),
      fixture,
    );
  }
  const fallback = snapFixture();
  if (fallback.evidence.kind !== "snap-invocation") throw new Error("fixture");
  assert.equal(
    classify({
      ...fallback,
      evidence: { ...fallback.evidence, buttonSource: "hit-fallback" },
    }),
    null,
  );
});

test("Excluded W08 remains uncounted; active W12 retains SQLite pause, stop, replay and retry protection", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "snap-invocation-"));
  const repository = new SqliteRepository(
    root,
    resolve("src/main/storage-worker.ts"),
  );
  t.after(async () => {
    await repository.close();
    await rm(root, { force: true, recursive: true });
  });
  let notifications = 0;
  const coach = new DurableCoach({
    repository,
    session: repository.session,
    date: () => "2026-10-21",
    now: () => 0,
    capabilities: () => [],
    changed: () => {},
    notify: async () => {
      notifications++;
      return true;
    },
  });
  await coach.initialize();
  coach.begin(1);
  const unknown = snapFixture("mouse", 1);
  if (unknown.evidence.kind !== "snap-invocation") throw new Error("fixture");
  await coach.accept({
    ...unknown,
    evidence: { ...unknown.evidence, settingsEnabled: null },
  });
  await coach.accept(unknown); // same ID cannot be changed to positive evidence
  assert.deepEqual(coach.snapshot().counts, {});
  coach.pauseNotifications(true);
  await coach.accept(taskbarFixture("mouse", 2));
  assert.equal(coach.snapshot().counts["2026-10-21"].W12?.mouse, 1);
  coach.stop();
  await coach.accept(taskbarFixture("mouse", 3));
  coach.begin(2);
  coach.pauseNotifications(false);
  const restarted = { ...taskbarFixture("key", 1), generation: 2 };
  await coach.accept(restarted);
  await coach.accept(restarted);
  assert.equal(notifications, 0);
  const commit = repository.commit.bind(repository);
  let fail = true;
  repository.commit = async (value) => {
    if (fail && value.count) throw new Error("fixture-write-failure");
    return commit(value);
  };
  await coach.accept({ ...taskbarFixture("mouse", 2), generation: 2 });
  assert.equal(coach.snapshot().pendingSave, true);
  assert.equal(notifications, 0);
  fail = false;
  await coach.retrySave();
  assert.equal(coach.snapshot().pendingSave, false);
  assert.equal(
    notifications,
    0,
    "retry must not resurrect the failed notification token",
  );
  assert.deepEqual(
    (await repository.query("2026-10-21", "2026-10-21")).counts["2026-10-21"]
      .W12,
    { mouse: 2, key: 1 },
  );
  assert.equal(
    coach.snapshot().coverage?.["2026-10-21"].W12?.knowledge,
    "not-observed",
    "no known zero/coverage claim from unknown runtime capability",
  );
});
