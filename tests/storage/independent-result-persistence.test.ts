import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, mock, type TestContext } from "node:test";
import { DurableCoach } from "../../src/core/durable-coach.ts";
import { SqliteRepository } from "../../src/main/sqlite-repository.ts";
import { StorageStore } from "../../src/main/storage-store.ts";
import type { ShortcutNotice } from "../../src/shared/coach.ts";
import type { RecordMutation } from "../../src/shared/storage.ts";
import {
  independentFixture,
  independentProofs,
} from "../support/independent-results.ts";

mock.module("electron", { namedExports: { app: {} } });
const { candidateV2 } = await import("../../src/main/observer.ts");
const today = "2026-11-13";
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "independent-results-"));
  const repository = new SqliteRepository(
    root,
    resolve("src/main/storage-worker.ts"),
  );
  t.after(async () => {
    await repository.close();
    await rm(root, { recursive: true, force: true });
  });
  const notices: ShortcutNotice[] = [];
  let now = 0;
  const coach = new DurableCoach({
    repository,
    session: repository.session,
    date: () => today,
    now: () => now,
    capabilities: () => [],
    changed: () => {},
    notify: async (notice) => {
      notices.push(notice);
      return true;
    },
  });
  await coach.initialize();
  coach.begin(1);
  return {
    root,
    repository,
    coach,
    notices,
    advance: () => {
      now += 1000;
    },
  };
}

test("strict parser to Core to real SQLite saves 1/2/3/all results with one notice and one revision", async (t) => {
  for (const indices of [[1], [1, 4], [0, 1, 2], [0, 1, 2, 3, 4, 5, 6, 7]]) {
    const h = await fixture(t);
    const parsed = candidateV2(
      independentFixture(indices.map((i) => independentProofs[i])),
    );
    assert.ok(parsed);
    const revision = h.coach.snapshot().revision!;
    await h.coach.accept(parsed);
    const state = await h.repository.load(today);
    assert.equal(Object.keys(state.counts[today] ?? {}).length, indices.length);
    assert.equal(state.revision, revision + 1);
    assert.equal(h.notices.length, 1);
    assert.equal(h.notices[0].items?.length ?? 1, indices.length);
    assert.deepEqual(h.coach.snapshot().counts, state.counts);
    await h.coach.accept({ ...parsed, sequence: 2 });
    assert.equal(h.notices.length, 1, "same transaction never notifies again");
    assert.equal((await h.repository.load(today)).revision, state.revision);
  }
});

test("all results record independently of guidance, learning and pause; invalid Core evidence records zero", async (t) => {
  const h = await fixture(t);
  await h.coach.setLearningState("W03", "mastered");
  const input = independentFixture(independentProofs.slice(1, 3));
  if (
    input.evidence.kind === "independent-results" &&
    input.evidence.results[0].kind === "monitor-move"
  ) {
    input.evidence.results[0].moveDirection = null;
    input.evidence.results[0].twoDisplayLayoutConfirmed = false;
  }
  await h.coach.accept(input);
  assert.equal(Object.keys(h.coach.snapshot().counts[today]).length, 2);
  assert.equal(h.notices.length, 0);
  h.coach.pauseNotifications(true);
  await h.coach.accept({
    ...independentFixture(),
    sequence: 2,
    transaction: 2,
  });
  assert.equal(Object.keys(h.coach.snapshot().counts[today]).length, 8);
  assert.equal(h.notices.length, 0);
  const revision = h.coach.snapshot().revision;
  const invalid = independentFixture();
  invalid.evidence = {
    ...invalid.evidence,
    results: [],
  } as typeof invalid.evidence;
  await h.coach.accept({ ...invalid, sequence: 3, transaction: 3 });
  assert.equal(h.coach.snapshot().revision, revision);
});

test("ACK loss retries identical full payload without double counts or deferred notification", async (t) => {
  const h = await fixture(t);
  const commit = h.repository.commit.bind(h.repository);
  const attempts: RecordMutation[] = [];
  h.repository.commit = async (value) => {
    attempts.push(structuredClone(value));
    await commit(value);
    if (attempts.length === 1) throw new Error("fixture lost ACK");
  };
  await h.coach.accept(independentFixture());
  assert.deepEqual(h.coach.snapshot().counts, {});
  assert.equal(h.notices.length, 0);
  await h.coach.retrySave();
  assert.deepEqual(attempts[0], attempts[1]);
  const counts = h.coach.snapshot().counts[today];
  assert.equal(Object.keys(counts).length, 8);
  assert.ok(Object.values(counts).every((c) => c.mouse === 1 && c.key === 0));
  assert.equal(h.notices.length, 0);
});

test("stop during a full-batch save retains every record and suppresses the pending notice", async (t) => {
  const h = await fixture(t);
  const commit = h.repository.commit.bind(h.repository);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  h.repository.commit = async (value) => {
    entered();
    await gate;
    await commit(value);
  };
  const save = h.coach.accept(independentFixture());
  await started;
  h.coach.stop();
  release();
  await save;
  assert.equal(Object.keys(h.coach.snapshot().counts[today]).length, 8);
  assert.equal(h.notices.length, 0);
});

test("previous-day all-operation batch retains coverage for every operation", async (t) => {
  const h = await fixture(t);
  const candidate = { ...independentFixture(), date: "2026-11-12" };
  await h.coach.accept(candidate);
  assert.equal(Object.keys(h.coach.snapshot().counts["2026-11-12"]).length, 8);
  assert.equal(
    Object.keys(h.coach.snapshot().coverage!["2026-11-12"]).length,
    8,
  );
});

for (const failure of ["second", "third", "last", "coverage", "checkpoint"]) {
  test(`failure at ${failure} rolls back every count, coverage, revision and checkpoint`, async (t) => {
    const h = await fixture(t);
    const before = await h.repository.load(today);
    const db = new DatabaseSync(join(h.root, "records-v1", "records.sqlite"));
    const target =
      failure === "checkpoint"
        ? "UPDATE ON meta"
        : failure === "coverage"
          ? "INSERT ON coverage"
          : "INSERT ON counts";
    const operation =
      failure === "second" ? "W02" : failure === "third" ? "W03" : "W12";
    db.exec(
      `CREATE TRIGGER fail_batch BEFORE ${target} ${failure === "checkpoint" || failure === "coverage" ? "" : `WHEN NEW.operation='${operation}'`} BEGIN SELECT RAISE(ABORT,'fixture batch failure'); END`,
    );
    try {
      h.advance();
      await h.coach.accept(independentFixture());
      assert.deepEqual(await h.repository.load(today), before);
      assert.deepEqual(h.coach.snapshot().counts, before.counts);
      assert.equal(h.notices.length, 0);
      assert.equal(h.coach.snapshot().pendingSave, true);
      db.exec("DROP TRIGGER fail_batch");
    } finally {
      db.close();
    }
    await h.coach.retrySave();
    const state = await h.repository.load(today);
    assert.equal(Object.keys(state.counts[today]).length, 8);
    assert.equal(state.revision, before.revision + 1);
    assert.equal(h.notices.length, 0);
  });
}

test("batch validation allows same-origin supported operations and rejects duplicates, mixed origin/day and count plus counts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "independent-batch-"));
  const store = new StorageStore(root);
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  store.claim("fixture");
  const counts: NonNullable<RecordMutation["counts"]> = [
    "W02",
    "W06",
    "W11",
  ].map((operation) => ({
    day: today,
    operation: operation as "W02" | "W06" | "W11",
    origin: "key",
  }));
  const batch: RecordMutation = {
    today,
    epoch: 1,
    writeSession: "fixture",
    sequence: 1,
    counts,
    coverage: [],
  };
  for (const invalid of [
    { ...batch, count: counts[0] },
    { ...batch, counts: [counts[0], counts[0]] },
    {
      ...batch,
      counts: [counts[0], { ...counts[1], origin: "mouse" as const }],
    },
    { ...batch, counts: [counts[0], { ...counts[1], day: "2026-11-12" }] },
    { ...batch, counts: [{ ...counts[0], operation: "W05" as const }] },
  ])
    assert.throws(() => store.commit(invalid));
  store.commit(batch);
  store.commit(batch);
  assert.equal(Object.keys(store.load(today).counts[today]).length, 3);
});
