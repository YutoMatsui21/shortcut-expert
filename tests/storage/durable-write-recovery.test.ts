import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { Worker } from "node:worker_threads";
import { DurableCoach, type Capability } from "../../src/core/durable-coach.ts";
import {
  SqliteRepository,
  selectRepository,
} from "../../src/main/sqlite-repository.ts";
import { StorageStore } from "../../src/main/storage-store.ts";
import type { RecordMutation } from "../../src/shared/storage.ts";
import type { Candidate } from "../support/fixtures.ts";
import { v2Fixture } from "../support/fixtures.ts";

const worker = resolve("src/main/storage-worker.ts");
test("explicit measurement preference survives reopen and deletion independently of notification pause", async (t) => {
  const h = await fixture(t);
  h.coach.pauseNotifications(true);
  await h.coach.setRecordingEnabled(false);
  assert.equal(h.coach.snapshot().observing, false);
  await h.coach.deleteCounts();
  await h.coach.opened();
  await h.coach.initialize();
  h.coach.begin(2);
  assert.equal(
    h.coach.snapshot().observing,
    false,
    "saved stop blocks automatic observation",
  );
  assert.equal(
    (await h.repository.load("2026-10-19")).settings.recordingEnabled,
    false,
  );
  await h.coach.setRecordingEnabled(true);
  h.coach.begin(3);
  assert.equal(h.coach.snapshot().observing, true);
  assert.equal(h.coach.snapshot().notificationsPaused, true);
  await h.repository.close();
  const reopened = new SqliteRepository(h.root, worker);
  try {
    const state = await reopened.load("2026-10-19");
    assert.equal(state.settings.recordingEnabled, true);
    await assert.rejects(
      reopened.saveSettings({
        ...state.settings,
        recordingEnabled: "yes",
      } as never),
    );
    assert.equal(
      (await reopened.load("2026-10-19")).settings.recordingEnabled,
      true,
    );
  } finally {
    await reopened.close();
  }
});
test("failed stop save stops immediately, keeps pending preference and retry never restarts measurement", async (t) => {
  const h = await fixture(t),
    save = h.repository.saveSettings.bind(h.repository);
  h.repository.saveSettings = async () => {
    throw new Error("fixture save failure");
  };
  await h.coach.setRecordingEnabled(false);
  assert.equal(h.coach.snapshot().observing, false);
  assert.equal(h.coach.snapshot().pendingSave, true);
  assert.equal(h.coach.snapshot().errorKind, "settings-save");
  h.coach.begin(2);
  assert.equal(h.coach.snapshot().observing, false);
  h.repository.saveSettings = save;
  await h.coach.retrySave();
  assert.equal(h.coach.snapshot().error, null);
  assert.equal(h.coach.snapshot().observing, false);
  await h.coach.initialize();
  h.coach.begin(3);
  assert.equal(h.coach.snapshot().observing, false);
});
test("normal bounds persist via the real worker, preserve learning settings and survive delete/reopen", async (t) => {
  const h = await fixture(t);
  const bounds = { x: -1200, y: 80, width: 1000, height: 650 };
  const revision = h.coach.snapshot().revision;
  await h.coach.setNormalBounds(bounds);
  assert.equal(h.coach.snapshot().revision, revision);
  assert.equal(
    (await h.repository.query("2026-10-19", "2026-10-19")).revision,
    revision,
    "bounds-only writes do not invalidate record views",
  );
  await h.coach.setLearningState("W03", "mastered");
  assert.notEqual(
    h.coach.snapshot().revision,
    revision,
    "learning changes still invalidate record views",
  );
  await h.coach.opened();
  await h.coach.deleteCounts();
  await h.repository.close();
  const reopened = new SqliteRepository(h.root, worker);
  try {
    const state = await reopened.load("2026-10-19");
    assert.deepEqual(state.settings.normalBounds, bounds);
    assert.equal(state.settings.states?.W03, "mastered");
    assert.equal(state.settings.opened, true);
    await assert.rejects(
      reopened.saveSettings({
        ...state.settings,
        normalBounds: { ...bounds, x: Infinity },
      }),
    );
    assert.deepEqual(
      (await reopened.load("2026-10-19")).settings.normalBounds,
      bounds,
    );
  } finally {
    await reopened.close();
  }
});
const candidate: Candidate = {
  type: "candidate",
  protocolVersion: 1,
  generation: 1,
  sequence: 1,
  app: "chrome",
  operation: "maximize",
  date: "2026-10-19",
  before: { state: "normal", arranged: false },
  after: { state: "maximized" },
  origin: "key",
  route: "win-up",
  injected: false,
  conflicted: false,
  moving: false,
  elevated: false,
  targetMatched: true,
  inputAgeMs: 100,
  monitor: null,
};
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "coach-sqlite-"));
  const repository = new SqliteRepository(root, worker);
  t.after(async () => {
    await repository.close();
    await rm(root, { recursive: true, force: true });
  });
  let today = "2026-10-19",
    now = 0;
  let dateReader = () => today;
  let capabilities: Capability[] = [
    { operation: "W03", revision: "fixture-v1" },
  ];
  let notifications = 0;
  const coach = new DurableCoach({
    repository,
    session: repository.session,
    date: () => dateReader(),
    now: () => now,
    capabilities: () => capabilities,
    notify: async () => {
      notifications++;
      return false;
    },
    changed: () => {},
  });
  await coach.initialize();
  assert.equal(coach.snapshot().error, null);
  coach.begin(1);
  return {
    root,
    repository,
    coach,
    date: (value: string) => {
      today = value;
    },
    time: (value: number) => {
      now = value;
    },
    dateReader: (read: () => string) => {
      dateReader = read;
    },
    capabilities: (value: Capability[]) => {
      capabilities = value;
    },
    notifications: () => notifications,
  };
}
test("empty userData -> real worker commit/counts/coverage -> reopen; bounded views retain >30 days", async (t) => {
  const h = await fixture(t);
  await h.coach.accept(v2Fixture({ ...candidate, date: "2026-01-01" }));
  assert.deepEqual(
    h.coach.snapshot().counts,
    {},
    "old record is disk-only, outside work set",
  );
  assert.equal(
    (await h.repository.query("2026-01-01", "2026-01-01")).counts["2026-01-01"]
      .W03?.key,
    1,
  );
  h.time(1000);
  await h.coach.tick();
  h.coach.pauseNotifications(true);
  h.time(2000);
  await h.coach.accept(v2Fixture({ ...candidate, sequence: 2 }));
  const saved = await h.repository.query("2026-10-19", "2026-10-19");
  assert.equal(saved.coverage["2026-10-19"].W03?.activeMs, 2000);
  assert.equal(saved.coverage["2026-10-19"].W03?.knowledge, "observed");
  assert.equal(saved.counts["2026-10-19"].W03?.key, 1);
  assert.equal(saved.coverage["2026-10-19"].W04?.knowledge, "not-observed");
  await h.repository.close();
  const reopened = new SqliteRepository(h.root, worker);
  try {
    assert.equal(
      (await reopened.load("2026-10-19")).counts["2026-10-19"].W03?.key,
      1,
    );
    assert.equal(
      (await reopened.query("2026-01-01", "2026-01-01")).counts["2026-01-01"]
        .W03?.key,
      1,
    );
    await assert.rejects(reopened.query("2020-01-01", "2026-10-19"));
  } finally {
    await reopened.close();
  }
});
test("pause continues; stop/fault/sleep-sized gaps/capability changes never accrue observation", async (t) => {
  const h = await fixture(t);
  h.time(1000);
  await h.coach.tick();
  h.coach.pauseNotifications(true);
  h.time(2000);
  await h.coach.tick();
  h.coach.stop();
  h.time(3000);
  await h.coach.tick();
  h.coach.begin(2);
  h.time(10000);
  await h.coach.tick();
  h.capabilities([]);
  h.time(11000);
  await h.coach.tick();
  h.capabilities([{ operation: "W03", revision: "fixture-v2" }]);
  h.time(12000);
  await h.coach.tick();
  h.coach.fault("fixture failure");
  h.time(13000);
  await h.coach.tick();
  const value = (await h.repository.query("2026-10-19", "2026-10-19")).coverage[
    "2026-10-19"
  ].W03!;
  assert.equal(value.activeMs, 2000);
  assert.equal(value.gap, true);
  assert.equal(value.capabilityRevision, "fixture-v2");
});
test("zero-operation day high water survives restart and stops date rollback without inventing known zero", async (t) => {
  const h = await fixture(t);
  h.date("2026-10-20");
  await h.coach.tick();
  const empty = await h.repository.query("2026-10-20", "2026-10-20");
  assert.deepEqual(empty.counts, {});
  assert.equal(empty.coverage["2026-10-20"].W03?.knowledge, "not-observed");
  h.date("2026-10-19");
  await h.coach.tick();
  assert.equal(h.coach.snapshot().observing, false);
  assert.match(h.coach.snapshot().error!, /日付/);
  assert.equal((await h.repository.load("2026-10-19")).highWater, "2026-10-20");
});
test("future candidate stops observation, retains source, and never creates future coverage", async (t) => {
  const h = await fixture(t);
  await h.coach.accept(v2Fixture({ ...candidate, date: "2026-10-20" }));
  assert.equal(h.coach.snapshot().observing, false);
  assert.deepEqual(h.coach.snapshot().counts, {});
  assert.deepEqual(
    (await h.repository.query("2026-10-20", "2026-10-20")).coverage,
    {},
  );
});
test("one writer; stale epochs and sessions; constant checkpoint; ACK loss retry never doubles count/reset", async (t) => {
  const h = await fixture(t);
  const second = new SqliteRepository(h.root, worker);
  await assert.rejects(second.load("2026-10-19"), /WRITER_ALREADY_ACTIVE/);
  await second.close();
  await h.repository.close();
  const store = new StorageStore(join(h.root, "records-v1"));
  try {
    store.claim("fixture-session");
    const batch: RecordMutation = {
      epoch: 1,
      writeSession: "fixture-session",
      sequence: 1,
      today: "2026-10-19",
      count: { day: "2026-10-19", operation: "W03", origin: "key" },
      coverage: [
        {
          day: "2026-10-19",
          operation: "W03",
          value: {
            knowledge: "observed",
            activeMs: 100,
            gap: true,
            capabilityRevision: "fixture",
          },
        },
      ],
    };
    store.commit(batch);
    store.commit(batch);
    assert.equal(store.load("2026-10-19").counts["2026-10-19"].W03?.key, 1);
    assert.equal(
      store.load("2026-10-19").coverage["2026-10-19"].W03?.activeMs,
      100,
    );
    assert.throws(
      () =>
        store.commit({ ...batch, count: { ...batch.count!, origin: "mouse" } }),
      /WRITE_CONFLICT/,
    );
    const reset = {
      ...batch,
      sequence: 2,
      count: undefined,
      coverage: [],
      reset: true,
    };
    store.commit(reset);
    store.commit(reset);
    assert.equal(store.load("2026-10-19").epoch, 2);
    assert.deepEqual(store.load("2026-10-19").counts, {});
    assert.throws(() => store.commit({ ...batch, sequence: 3 }), /STALE_EPOCH/);
    store.claim("new-process");
    assert.throws(
      () => store.commit({ ...batch, epoch: 2, sequence: 3 }),
      /STALE_SESSION/,
    );
    const metaDb = new DatabaseSync(
      join(h.root, "records-v1", "records.sqlite"),
      { readOnly: true },
    );
    try {
      assert.equal(
        metaDb.prepare("SELECT count(*) AS n FROM meta").get()!.n,
        1,
      );
    } finally {
      metaDb.close();
    }
  } finally {
    store.close();
  }
});
test("delete drains an in-flight durable write, discards queued old candidates and remains empty after reopen", async (t) => {
  const h = await fixture(t),
    commit = h.repository.commit.bind(h.repository);
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  h.repository.commit = async (value) => {
    if (value.count) {
      entered();
      await held;
    }
    await commit(value);
  };
  const writing = h.coach.accept(v2Fixture(candidate));
  await started;
  const queued = h.coach.accept(v2Fixture({ ...candidate, sequence: 2 }));
  const deletion = h.coach.deleteCounts();
  assert.equal(h.coach.snapshot().observing, false);
  release();
  await Promise.all([writing, queued, deletion]);
  assert.deepEqual(h.coach.snapshot().counts, {});
  assert.deepEqual(h.coach.snapshot().coverage, {});
  h.coach.begin(3);
  await h.coach.accept(v2Fixture({ ...candidate, sequence: 3 }));
  assert.deepEqual(h.coach.snapshot().counts, {});
  await h.repository.close();
  const reopened = new SqliteRepository(h.root, worker);
  try {
    assert.deepEqual((await reopened.load("2026-10-19")).counts, {});
  } finally {
    await reopened.close();
  }
});

test("retry completes confirmed deletion after an earlier pending record write keeps failing", async (t) => {
  const h = await fixture(t),
    commit = h.repository.commit.bind(h.repository);
  h.repository.commit = async () => {
    throw new Error("fixture write failure");
  };
  await h.coach.accept(v2Fixture(candidate));
  await h.coach.deleteCounts();
  assert.equal(h.coach.snapshot().pendingSave, true);
  h.repository.commit = commit;
  await h.coach.retrySave();
  assert.equal(h.coach.snapshot().pendingSave, false);
  assert.deepEqual(
    h.coach.snapshot().counts,
    {},
    "retry must finish deletion, not only save the old write",
  );
  assert.deepEqual(h.coach.snapshot().coverage, {});
  assert.equal((await h.repository.load("2026-10-19")).epoch, 2);
});

test("lost ACK through real worker commit retains exact pending mutation; retry and reopen are nonduplicating", async (t) => {
  const h = await fixture(t);
  const commit = h.repository.commit.bind(h.repository);
  let lose = true;
  h.repository.commit = async (value) => {
    await commit(value);
    if (lose) {
      lose = false;
      throw new Error("lost ACK");
    }
  };
  await h.coach.accept(
    v2Fixture({
      ...candidate,
      origin: "mouse",
      route: "max-button",
      monitor: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
  );
  assert.equal(h.coach.snapshot().observing, false);
  assert.equal(h.coach.snapshot().pendingSave, true);
  await Promise.all([h.coach.retrySave(), h.coach.retrySave()]);
  assert.equal(h.coach.snapshot().pendingSave, false);
  assert.equal(h.coach.snapshot().observing, false);
  assert.equal(h.coach.snapshot().counts["2026-10-19"].W03?.mouse, 1);
  assert.equal(
    h.notifications(),
    0,
    "ACK recovery must not resurrect an eligible notice canceled by the fault",
  );
  await h.repository.close();
  const reopened = new SqliteRepository(h.root, worker);
  let notices = 0;
  try {
    const fresh = new DurableCoach({
      repository: reopened,
      session: reopened.session,
      date: () => "2026-10-19",
      now: () => 0,
      capabilities: () => [],
      notify: async () => {
        notices++;
        return true;
      },
      changed: () => {},
    });
    await fresh.initialize();
    fresh.begin(2);
    await fresh.idle();
    assert.equal(fresh.snapshot().counts["2026-10-19"].W03?.mouse, 1);
    assert.equal(
      notices,
      0,
      "restarting must not reconstruct notification tokens",
    );
  } finally {
    await reopened.close();
  }
});
test("commit failure retry saves the pending count once and never replays its canceled notice", async (t) => {
  const h = await fixture(t),
    commit = h.repository.commit.bind(h.repository);
  h.repository.commit = async () => {
    throw new Error("fixture disk failure");
  };
  await h.coach.accept(
    v2Fixture({
      ...candidate,
      origin: "mouse",
      route: "max-button",
      monitor: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
  );
  assert.equal(h.coach.snapshot().errorKind, "record-save");
  assert.equal(h.coach.snapshot().pendingSave, true);
  assert.equal(h.notifications(), 0);
  h.repository.commit = commit;
  await h.coach.retrySave();
  assert.equal(h.coach.snapshot().pendingSave, false);
  assert.equal(h.coach.snapshot().observing, false);
  assert.equal(h.coach.snapshot().counts["2026-10-19"].W03?.mouse, 1);
  assert.equal(h.notifications(), 0);
  h.coach.begin(2);
  assert.equal(h.coach.snapshot().observing, true);
  await h.coach.accept(
    v2Fixture({
      ...candidate,
      generation: 2,
      origin: "mouse",
      route: "max-button",
      monitor: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
  );
  assert.equal(
    h.notifications(),
    1,
    "only a new eligible observation may request a notice",
  );
});
test("storage read failure is retryable without replacing data or automatically resuming observation", async (t) => {
  const h = await fixture(t),
    load = h.repository.load.bind(h.repository);
  await h.coach.accept(v2Fixture(candidate));
  await h.coach.setLearningState("W03", "mastered");
  const before = h.coach.snapshot();
  h.repository.load = async () => {
    throw new Error("fixture read failure");
  };
  await h.coach.initialize();
  assert.equal(h.coach.snapshot().errorKind, "storage");
  assert.equal(h.coach.snapshot().observing, false);
  h.repository.load = load;
  await h.coach.retrySave();
  assert.equal(h.coach.snapshot().error, null);
  assert.equal(h.coach.snapshot().pendingSave, false);
  assert.deepEqual(h.coach.snapshot().counts, before.counts);
  assert.deepEqual(h.coach.snapshot().settings, before.settings);
  assert.equal(h.coach.snapshot().observing, false);
  h.coach.begin(2);
  assert.equal(
    h.coach.snapshot().observing,
    true,
    "restart remains an explicit action",
  );
});
test("storage recovery cannot erase a separate clock fault", async (t) => {
  const h = await fixture(t);
  h.date("2026-10-20");
  await h.coach.tick();
  h.date("2026-10-19");
  await h.coach.tick();
  h.coach.storageFault("fixture storage read failure");
  assert.equal(h.coach.snapshot().canRetrySave, true);
  await h.coach.retrySave();
  h.coach.begin(2);
  assert.equal(h.coach.snapshot().errorKind, "clock");
  assert.equal(h.coach.snapshot().canRetrySave, false);
  assert.match(h.coach.snapshot().error!, /日付/);
  assert.equal(h.coach.snapshot().observing, false);
});
test("retrying a read failure revalidates the stored clock high water before allowing start", async (t) => {
  const h = await fixture(t);
  h.coach.storageFault("fixture read failure");
  h.date("2026-10-18");
  await h.coach.retrySave();
  h.coach.begin(2);
  assert.equal(h.coach.snapshot().errorKind, "clock");
  assert.equal(h.coach.snapshot().observing, false);
});
test("real Worker exit stops observation; pending start and repeated retry cannot lose or double the count", async (t) => {
  const h = await fixture(t);
  const active = Reflect.get(h.repository, "worker");
  assert.ok(active instanceof Worker);
  active.postMessage = () => {
    void active.terminate();
  };
  await h.coach.accept(v2Fixture(candidate));
  assert.equal(h.coach.snapshot().pendingSave, true);
  assert.equal(h.coach.snapshot().errorKind, "record-save");
  h.coach.begin(2);
  assert.equal(h.coach.snapshot().observing, false);
  await Promise.all([
    h.coach.retrySave(),
    h.coach.retrySave(),
    h.coach.retrySave(),
  ]);
  assert.equal(h.coach.snapshot().pendingSave, false);
  assert.equal(h.coach.snapshot().observing, false);
  assert.equal(
    (await h.repository.load("2026-10-19")).counts["2026-10-19"].W03?.key,
    1,
  );
});
test("settings ACK loss preserves confirmed state until retry; newest pending settings survive repeated retry", async (t) => {
  const h = await fixture(t),
    save = h.repository.saveSettings.bind(h.repository);
  h.repository.saveSettings = async (value) => {
    await save(value);
    throw new Error("fixture settings ACK loss");
  };
  await h.coach.setLearningState("W03", "mastered");
  await h.coach.setLearningState("W04", "excluded");
  assert.equal(h.coach.snapshot().settings.states?.W03, undefined);
  assert.equal(h.coach.snapshot().errorKind, "settings-save");
  assert.equal(h.coach.snapshot().observing, false);
  h.repository.saveSettings = save;
  await Promise.all([h.coach.retrySave(), h.coach.retrySave()]);
  assert.equal(h.coach.snapshot().settings.states?.W03, "mastered");
  assert.equal(h.coach.snapshot().settings.states?.W04, "excluded");
  assert.equal(h.coach.snapshot().pendingSave, false);
  assert.equal(h.coach.snapshot().observing, false);
});
test("one retry resolves pending settings and a separate storage read fault together", async (t) => {
  const h = await fixture(t),
    save = h.repository.saveSettings.bind(h.repository);
  h.repository.saveSettings = async () => {
    throw new Error("fixture settings failure");
  };
  await h.coach.setLearningState("W03", "mastered");
  h.coach.storageFault("fixture separate read failure");
  h.repository.saveSettings = save;
  await h.coach.retrySave();
  assert.equal(h.coach.snapshot().settings.states?.W03, "mastered");
  assert.equal(h.coach.snapshot().pendingSave, false);
  assert.equal(h.coach.snapshot().canRetrySave, false);
  assert.equal(h.coach.snapshot().error, null);
  assert.equal(h.coach.snapshot().observing, false);
});
test("existing JSON remains byte-identical; authority/missing DB/unknown schema never fall back or overwrite", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "coach-legacy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = '{"schemaVersion":99,"days":{}}';
  await writeFile(join(root, "counts.json"), original);
  const invalid = await selectRepository(root, worker);
  assert.ok(invalid instanceof SqliteRepository);
  try {
    await assert.rejects(invalid.load("2026-10-19"));
  } finally {
    await invalid.close();
  }
  assert.equal(await readFile(join(root, "counts.json"), "utf8"), original);
  await mkdir(join(root, "records-v1"));
  await writeFile(
    join(root, "records-v1", "authority.json"),
    '{"schemaVersion":99}',
  );
  const repo = await selectRepository(root, worker);
  assert.ok(repo instanceof SqliteRepository);
  try {
    await assert.rejects(repo.load("2026-10-19"));
  } finally {
    await repo.close();
  }
  assert.equal(
    await readFile(join(root, "records-v1", "authority.json"), "utf8"),
    '{"schemaVersion":99}',
  );
});
test("real transaction rollback preserves counts/coverage/checkpoint; identical retry succeeds", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "coach-rollback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let store = new StorageStore(root);
  store.claim("rollback");
  store.close();
  const file = join(root, "records.sqlite");
  const inject = new DatabaseSync(file);
  inject.exec(
    "CREATE TRIGGER fail_coverage BEFORE INSERT ON coverage BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END;",
  );
  inject.close();
  store = new StorageStore(root);
  const batch: RecordMutation = {
    epoch: 1,
    writeSession: "rollback",
    sequence: 1,
    today: "2026-10-19",
    count: { day: "2026-10-19", operation: "W03", origin: "mouse" },
    coverage: [
      {
        day: "2026-10-19",
        operation: "W03",
        value: {
          knowledge: "observed",
          activeMs: 50,
          gap: true,
          capabilityRevision: "fixture",
        },
      },
    ],
  };
  assert.throws(() => store.commit(batch), /fixture disk failure/);
  assert.deepEqual(store.load("2026-10-19").counts, {});
  assert.deepEqual(store.load("2026-10-19").coverage, {});
  assert.equal(store.load("2026-10-19").highWater, "");
  store.close();
  const repair = new DatabaseSync(file);
  repair.exec("DROP TRIGGER fail_coverage");
  repair.close();
  store = new StorageStore(root);
  try {
    store.commit(batch);
    assert.equal(store.load("2026-10-19").counts["2026-10-19"].W03?.mouse, 1);
  } finally {
    store.close();
  }
});
test("disk transaction rejection through the real Worker preserves prior data and retries the delta once", async (t) => {
  const h = await fixture(t);
  await h.coach.accept(v2Fixture(candidate));
  await h.coach.setLearningState("W03", "mastered");
  const before = await h.repository.query("2026-10-19", "2026-10-19");
  const file = join(h.root, "records-v1", "records.sqlite");
  const inject = new DatabaseSync(file);
  try {
    inject.exec(
      "CREATE TRIGGER issue25_disk_failure BEFORE INSERT ON coverage BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END;",
    );
  } finally {
    inject.close();
  }
  h.time(1000);
  await h.coach.accept(v2Fixture({ ...candidate, sequence: 2 }));
  assert.deepEqual(
    await h.repository.query("2026-10-19", "2026-10-19"),
    before,
  );
  assert.equal(h.coach.snapshot().observing, false);
  assert.equal(h.coach.snapshot().pendingSave, true);
  const repair = new DatabaseSync(file);
  try {
    repair.exec("DROP TRIGGER issue25_disk_failure");
  } finally {
    repair.close();
  }
  await Promise.all([h.coach.retrySave(), h.coach.retrySave()]);
  const saved = await h.repository.load("2026-10-19");
  assert.equal(saved.counts["2026-10-19"].W03?.key, 2);
  assert.equal(saved.coverage["2026-10-19"].W03?.activeMs, 1000);
  assert.equal(saved.settings.states?.W03, "mastered");
  assert.equal(h.coach.snapshot().observing, false);
});
test("abnormal Main process exit releases single writer and preserves committed disk record", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "coach-crash-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const child = spawn(
    process.execPath,
    ["tests/fixtures/storage-crash.ts", root],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("child commit timeout")),
      5000,
    );
    let output = "";
    child.stdout.on("data", (bytes) => {
      output += bytes;
      if (output.includes("COMMITTED")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      if (!output.includes("COMMITTED")) reject(new Error("child failed"));
    });
  });
  child.kill();
  await exited;
  const reopened = new SqliteRepository(root, worker);
  try {
    assert.equal(
      (await reopened.load("2026-10-19")).counts["2026-10-19"].W03?.key,
      1,
    );
  } finally {
    await reopened.close();
  }
});
test("missing/corrupt/future-version DB stays protected and never falls back to old JSON", async (t) => {
  for (const mode of ["missing", "corrupt", "future"]) {
    const root = await mkdtemp(join(tmpdir(), "coach-protected-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    let repo = new SqliteRepository(root, worker);
    await repo.load("2026-10-19");
    await repo.close();
    const file = join(root, "records-v1", "records.sqlite");
    if (mode === "missing") await rm(file);
    if (mode === "corrupt") await writeFile(file, "corrupt fixture");
    if (mode === "future") {
      const db = new DatabaseSync(file);
      db.exec("PRAGMA user_version=99");
      db.close();
    }
    const before = mode === "missing" ? null : await readFile(file);
    await writeFile(join(root, "counts.json"), '{"schemaVersion":1,"days":{}}');
    const selected = await selectRepository(root, worker);
    assert.ok(selected instanceof SqliteRepository);
    repo = selected;
    try {
      await assert.rejects(repo.load("2026-10-19"));
    } finally {
      await repo.close();
    }
    if (before) assert.deepEqual(await readFile(file), before);
    else await assert.rejects(readFile(file));
  }
});
test("stopped zero-operation dates advance only high water and never create coverage or counts", async (t) => {
  const h = await fixture(t);
  h.coach.stop();
  h.date("2026-10-20");
  await h.coach.tick();
  const result = await h.repository.query("2026-10-20", "2026-10-20");
  assert.deepEqual(result.counts, {});
  assert.deepEqual(result.coverage, {});
  assert.equal((await h.repository.load("2026-10-20")).highWater, "2026-10-20");
});
test("settings retry cannot clear a helper fault; deletion retains settings and rejects old generation", async (t) => {
  const h = await fixture(t);
  const settings = h.repository.saveSettings.bind(h.repository);
  h.repository.saveSettings = async () => {
    throw new Error("fixture settings failure");
  };
  await h.coach.setLearningState("W03", "excluded");
  h.coach.fault("fixture helper failure");
  h.repository.saveSettings = settings;
  await h.coach.retrySave();
  h.coach.begin(2);
  assert.equal(h.coach.snapshot().observing, false);
  assert.equal(h.coach.snapshot().error, "fixture helper failure");
  await h.coach.initialize();
  h.coach.begin(2);
  await h.coach.accept(v2Fixture({ ...candidate, generation: 2 }));
  await h.coach.deleteCounts();
  assert.deepEqual(h.coach.snapshot().counts, {});
  assert.deepEqual(h.coach.snapshot().coverage, {});
  assert.deepEqual(h.coach.snapshot().settings.muted, ["W03"]);
  h.coach.begin(3);
  await h.coach.accept(v2Fixture({ ...candidate, generation: 2, sequence: 2 }));
  assert.deepEqual(h.coach.snapshot().counts, {});
  await h.coach.accept(v2Fixture({ ...candidate, generation: 3 }));
  assert.equal(h.coach.snapshot().counts["2026-10-19"].W03?.key, 1);
});
test("load failure cannot be erased by opened/settings writes or restart observation", async (t) => {
  const h = await fixture(t);
  const load = h.repository.load.bind(h.repository);
  h.repository.load = async () => {
    throw new Error("fixture load failure");
  };
  let writes = 0;
  const save = h.repository.saveSettings.bind(h.repository);
  h.repository.saveSettings = async (value) => {
    writes++;
    await save(value);
  };
  await h.coach.initialize();
  await h.coach.opened();
  await h.coach.setLearningState("W03", "excluded");
  h.coach.begin(2);
  assert.equal(writes, 0);
  assert.match(h.coach.snapshot().error!, /読み込めません/);
  assert.equal(h.coach.snapshot().observing, false);
  h.repository.load = load;
  await h.coach.initialize();
  h.coach.begin(2);
  assert.equal(h.coach.snapshot().observing, true);
});
test("stopped ticks preserve revision and checkpoint until date changes; rollback is still detected", async (t) => {
  const h = await fixture(t);
  h.coach.stop();
  const before = (await h.repository.load("2026-10-19")).revision;
  for (let i = 1; i <= 4; i++) {
    h.time(i * 1000);
    await h.coach.tick();
  }
  assert.equal((await h.repository.load("2026-10-19")).revision, before);
  h.date("2026-10-20");
  await h.coach.tick();
  assert.equal((await h.repository.load("2026-10-20")).revision, before + 1);
  h.date("2026-10-19");
  await h.coach.tick();
  assert.match(h.coach.snapshot().error!, /日付/);
});
test("durable v2 consumes transactions once, rejects version mixing and protects queued payload", async (t) => {
  const h = await fixture(t);
  const v2 = v2Fixture(candidate, 10);
  const accepted = h.coach.accept(v2Fixture(v2));
  v2.date = "2099-01-01";
  await accepted;
  await h.coach.accept(v2Fixture({ ...v2Fixture(candidate, 10), sequence: 2 }));
  await h.coach.accept({
    ...v2Fixture(candidate),
    sequence: 3,
    protocolVersion: 1,
  } as unknown as import("../../src/shared/coach.ts").CandidateV2);
  await h.coach.accept(v2Fixture({ ...v2Fixture(candidate, 11), sequence: 3 }));
  assert.equal(h.coach.snapshot().counts["2026-10-19"].W03?.key, 2);
  const unverified = v2Fixture(candidate, 12);
  unverified.evidence.profile = "unverified";
  unverified.sequence = 4;
  await h.coach.accept(v2Fixture(unverified));
  await h.coach.accept(v2Fixture({ ...v2Fixture(candidate, 12), sequence: 5 }));
  assert.equal(h.coach.snapshot().counts["2026-10-19"].W03?.key, 2);
});
test("settings failure and recovery preserve a preexisting clock error", async (t) => {
  const h = await fixture(t);
  h.date("2026-10-20");
  await h.coach.tick();
  h.date("2026-10-19");
  await h.coach.tick();
  const save = h.repository.saveSettings.bind(h.repository);
  h.repository.saveSettings = async () => {
    throw new Error("fixture settings");
  };
  await h.coach.setLearningState("W03", "excluded");
  h.repository.saveSettings = save;
  await h.coach.retrySave();
  h.coach.begin(2);
  assert.match(h.coach.snapshot().error!, /日付/);
  assert.equal(h.coach.snapshot().observing, false);
});
test("explicit full deletion recovers from a future high water without restoring old records", async (t) => {
  const h = await fixture(t);
  await h.coach.accept(v2Fixture(candidate));
  h.date("2026-10-20");
  await h.coach.tick();
  h.date("2026-10-19");
  await h.coach.tick();
  assert.match(h.coach.snapshot().error!, /日付/);
  await h.coach.deleteCounts();
  assert.equal(h.coach.snapshot().error, null);
  assert.deepEqual(h.coach.snapshot().counts, {});
  const state = await h.repository.load("2026-10-19");
  assert.equal(state.epoch, 2);
  assert.equal(state.highWater, "2026-10-19");
  h.coach.begin(2);
  await h.coach.accept(v2Fixture({ ...candidate, generation: 2 }));
  assert.equal(h.coach.snapshot().counts["2026-10-19"].W03?.key, 1);
});
test("a second toggle and opened preserve earlier pending settings changes", async (t) => {
  const h = await fixture(t);
  const save = h.repository.saveSettings.bind(h.repository);
  h.repository.saveSettings = async () => {
    throw new Error("fixture settings");
  };
  await h.coach.setLearningState("W03", "excluded");
  h.repository.saveSettings = save;
  await h.coach.setLearningState("W04", "excluded");
  await h.coach.opened();
  const settings = (await h.repository.load("2026-10-19")).settings;
  assert.deepEqual(settings.muted, ["W03", "W04"]);
  assert.equal(settings.opened, true);
  assert.equal(h.coach.snapshot().pendingSave, false);
});
test("midnight during post-commit refresh never expands the bounded query to 61 days", async (t) => {
  const h = await fixture(t);
  const commit = h.repository.commit.bind(h.repository);
  h.repository.commit = async (value) => {
    await commit(value);
    let first = true;
    h.dateReader(() => {
      if (first) {
        first = false;
        return "2026-10-19";
      }
      return "2026-10-20";
    });
  };
  await h.coach.accept(v2Fixture(candidate));
  assert.equal(h.coach.snapshot().error, null);
  assert.equal(h.coach.snapshot().pendingSave, false);
  assert.equal(h.coach.snapshot().counts["2026-10-19"].W03?.key, 1);
});
