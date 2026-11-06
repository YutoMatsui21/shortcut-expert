import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  renameSync,
  rmdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { SqliteRepository } from "../../src/main/sqlite-repository.ts";
import {
  prepareStorage,
  readLegacy,
} from "../../src/main/storage-migration.ts";
import { StorageStore } from "../../src/main/storage-store.ts";

function fixture(t: import("node:test").TestContext) {
  const root = mkdtempSync(join(tmpdir(), "coach-migration-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const counts = {
    schemaVersion: 1,
    days: {
      "2020-01-02": { W01: { key: 4, mouse: 9 }, W09: { mouse: 80, key: 90 } },
      "2026-10-18": { W03: { mouse: 3, key: 2 }, W11: { mouse: 0, key: 0 } },
    },
  };
  writeFileSync(
    join(root, "counts.json"),
    "  " + JSON.stringify(counts) + "\n",
  );
  writeFileSync(
    join(root, "settings.json"),
    JSON.stringify({ schemaVersion: 1, muted: ["W03", "W09"], opened: true }),
  );
  return { root, target: join(root, "records-v1"), counts };
}
test("strict migration preserves bytes, every old row, unknown coverage and all learning states through worker restart", async (t) => {
  const h = fixture(t),
    original = readFileSync(join(h.root, "counts.json"));
  const repository = new SqliteRepository(
    h.root,
    resolve("src/main/storage-worker.ts"),
  );
  try {
    const state = await repository.load("2026-10-19");
    assert.equal(state.settings.opened, true);
    assert.equal(state.settings.states?.W03, "excluded");
    assert.equal(state.settings.states?.W12, "learning");
    assert.equal(state.settings.states?.W14, "learning");
    assert.equal(
      Object.values(state.settings.states!).includes("mastered"),
      false,
    );
    assert.deepEqual(
      (await repository.query("2020-01-02", "2020-01-02")).counts["2020-01-02"],
      h.counts.days["2020-01-02"],
    );
    assert.deepEqual(state.coverage["2026-10-18"].W03, {
      knowledge: "legacy-unknown",
      activeMs: 0,
      gap: true,
      capabilityRevision: "legacy-v1",
    });
    assert.equal(state.counts["2026-10-18"].W12, undefined);
    assert.deepEqual(readFileSync(join(h.root, "counts.json")), original);
  } finally {
    await repository.close();
  }
  const restarted = new SqliteRepository(
    h.root,
    resolve("src/main/storage-worker.ts"),
  );
  try {
    assert.equal(
      (await restarted.load("2026-10-19")).counts["2026-10-18"].W03?.mouse,
      3,
    );
  } finally {
    await restarted.close();
  }
});
test("missing documents keep defaults and stay missing; malformed, extra fields, future versions stop before staging", (t) => {
  const h = fixture(t);
  rmSync(join(h.root, "settings.json"));
  prepareStorage(h.target);
  assert.equal(existsSync(join(h.root, "settings.json")), false);
  const store = new StorageStore(h.target);
  try {
    assert.equal(store.load("2026-10-19").settings.opened, false);
  } finally {
    store.close();
  }
  for (const document of [
    "{",
    '{"schemaVersion":2,"days":{}}',
    '{"schemaVersion":1,"days":{"2026-02-30":{}}}',
    '{"schemaVersion":1,"days":{},"raw":"forbidden"}',
    '{"schemaVersion":1,"days":{"2020-01-01":{"W03":{"mouse":-1,"key":0}}}}',
  ]) {
    const root = mkdtempSync(join(tmpdir(), "coach-invalid-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(join(root, "counts.json"), document);
    assert.throws(() => prepareStorage(join(root, "records-v1")));
    assert.equal(existsSync(join(root, "migration-v1")), false);
    assert.equal(readFileSync(join(root, "counts.json"), "utf8"), document);
  }
});
test("owned interrupted stage resumes idempotently; all-row mismatch and source changes never activate", (t) => {
  const h = fixture(t),
    source = readLegacy(h.root),
    stage = join(h.root, "migration-v1");
  mkdirSync(stage);
  writeFileSync(
    join(stage, "source.json"),
    JSON.stringify({ schemaVersion: 1, identity: source.identity }),
  );
  const store = new StorageStore(stage, "staging");
  store.importLegacy(source);
  store.close();
  const db = new DatabaseSync(join(stage, "records.sqlite"));
  db.exec(
    "UPDATE counts SET mouse=mouse+1 WHERE operation='W01'; UPDATE counts SET mouse=mouse-1 WHERE operation='W09'",
  );
  db.close();
  assert.throws(() => prepareStorage(h.target), /MIGRATION_COUNTS/);
  assert.equal(existsSync(h.target), false);
  const repaired = new DatabaseSync(join(stage, "records.sqlite"));
  repaired.exec(
    "UPDATE counts SET mouse=mouse-1 WHERE operation='W01'; UPDATE counts SET mouse=mouse+1 WHERE operation='W09'",
  );
  repaired.close();
  writeFileSync(join(h.root, "counts.json"), JSON.stringify(h.counts));
  assert.throws(() => prepareStorage(h.target), /SOURCE_CONFLICT/);
  writeFileSync(
    join(h.root, "counts.json"),
    "  " + JSON.stringify(h.counts) + "\n",
  );
  prepareStorage(h.target);
  prepareStorage(h.target);
  assert.equal(existsSync(stage), false);
});
test("schema-only interrupted migration and transaction failure resume without partial imports", (t) => {
  const h = fixture(t),
    source = readLegacy(h.root),
    stage = join(h.root, "migration-v1");
  mkdirSync(stage);
  writeFileSync(
    join(stage, "source.json"),
    JSON.stringify({ schemaVersion: 1, identity: source.identity }),
  );
  const empty = new StorageStore(stage, "staging");
  empty.close();
  const db = new DatabaseSync(join(stage, "records.sqlite"));
  db.exec(
    "CREATE TRIGGER fail_import BEFORE INSERT ON counts WHEN NEW.operation='W09' BEGIN SELECT RAISE(ABORT,'fixture'); END;",
  );
  db.close();
  assert.throws(() => prepareStorage(h.target));
  assert.equal(existsSync(h.target), false);
  const check = new DatabaseSync(join(stage, "records.sqlite"));
  assert.equal(check.prepare("SELECT COUNT(*) AS n FROM counts").get()?.n, 0);
  assert.equal(
    check.prepare("SELECT COUNT(*) AS n FROM migration").get()?.n,
    0,
  );
  check.exec("DROP TRIGGER fail_import");
  check.close();
  prepareStorage(h.target);
  const complete = new StorageStore(h.target);
  try {
    complete.verifyLegacy(source);
  } finally {
    complete.close();
  }
});
test("purge failure remains pending after committed deletion and retries before any new observation", (t) => {
  const h = fixture(t);
  prepareStorage(h.target);
  const original = join(h.root, "counts.json");
  renameSync(original, join(h.root, "retained-fixture.json"));
  mkdirSync(original);
  const store = new StorageStore(h.target);
  store.claim("purge");
  const reset = {
    epoch: 1,
    writeSession: "purge",
    sequence: 1,
    today: "2026-10-19",
    coverage: [],
    reset: true as const,
  };
  assert.throws(() => store.commit(reset));
  assert.deepEqual(store.load("2026-10-19").counts, {});
  store.close();
  assert.throws(() => new StorageStore(h.target));
  rmdirSync(original);
  renameSync(join(h.root, "retained-fixture.json"), original);
  const resumed = new StorageStore(h.target);
  try {
    resumed.commit(reset);
    assert.equal(existsSync(original), false);
    assert.deepEqual(resumed.load("2026-10-19").counts, {});
  } finally {
    resumed.close();
  }
});
test("unowned stage stops; activated authority never reimports missing/corrupt DB; delete purges copies and restart stays empty", async (t) => {
  const h = fixture(t);
  mkdirSync(join(h.root, "migration-v1"));
  assert.throws(() => prepareStorage(h.target), /SOURCE_CONFLICT/);
  rmdirSync(join(h.root, "migration-v1"));
  prepareStorage(h.target);
  renameSync(
    join(h.target, "records.sqlite"),
    join(h.target, "missing.sqlite"),
  );
  prepareStorage(h.target);
  assert.throws(() => new StorageStore(h.target), /DATABASE_MISSING/);
  renameSync(
    join(h.target, "missing.sqlite"),
    join(h.target, "records.sqlite"),
  );
  const store = new StorageStore(h.target);
  store.claim("delete");
  store.commit({
    epoch: 1,
    writeSession: "delete",
    sequence: 1,
    today: "2026-10-19",
    coverage: [],
    reset: true,
  });
  assert.equal(existsSync(join(h.root, "counts.json")), false);
  assert.equal(existsSync(join(h.root, "settings.json")), false);
  store.close();
  prepareStorage(h.target);
  const reopened = new StorageStore(h.target);
  try {
    assert.deepEqual(reopened.query("2020-01-02", "2020-01-02").counts, {});
    assert.equal(reopened.load("2026-10-19").settings.opened, true);
  } finally {
    reopened.close();
  }
});
test("empty legacy dates survive import, bounded read, verification and deletion", (t) => {
  const h = fixture(t),
    sourceCounts = {
      schemaVersion: 1,
      days: { "2019-01-01": {}, ...h.counts.days, "2026-10-19": {} },
    };
  writeFileSync(join(h.root, "counts.json"), JSON.stringify(sourceCounts));
  const source = readLegacy(h.root);
  prepareStorage(h.target);
  const store = new StorageStore(h.target);
  try {
    store.verifyLegacy(source);
    assert.deepEqual(store.query("2019-01-01", "2019-01-01").counts, {
      "2019-01-01": {},
    });
    assert.deepEqual(store.query("2019-01-01", "2019-01-01").coverage, {});
    store.claim("delete-empty");
    store.commit({
      epoch: 1,
      writeSession: "delete-empty",
      sequence: 1,
      today: "2026-10-19",
      coverage: [],
      reset: true,
    });
    assert.deepEqual(store.query("2019-01-01", "2019-01-01").counts, {});
  } finally {
    store.close();
  }
});
test("migrated target with both DB and initialization marker missing never recreates empty authority", (t) => {
  const h = fixture(t);
  prepareStorage(h.target);
  rmSync(join(h.target, "records.sqlite"));
  rmSync(join(h.target, "initialized"));
  assert.throws(() => new StorageStore(h.target), /DATABASE_MISSING/);
  assert.equal(existsSync(join(h.target, "records.sqlite")), false);
  assert.equal(existsSync(join(h.root, "counts.json")), true);
});
test("corrupt staging purge meta is rejected before touching either original", (t) => {
  const h = fixture(t),
    stage = join(h.root, "migration-v1"),
    source = readLegacy(h.root);
  mkdirSync(stage);
  writeFileSync(
    join(stage, "source.json"),
    JSON.stringify({ schemaVersion: 1, identity: source.identity }),
  );
  const store = new StorageStore(stage, "staging");
  store.importLegacy(source);
  store.close();
  const db = new DatabaseSync(join(stage, "records.sqlite"));
  db.exec("UPDATE migration SET purge=1");
  db.close();
  assert.throws(() => prepareStorage(h.target));
  assert.equal(existsSync(h.target), false);
  assert.equal(readLegacy(h.root).identity, source.identity);
});
test("migrated authority rejects missing legacy day table instead of silently recreating empty dates", (t) => {
  const h = fixture(t);
  writeFileSync(
    join(h.root, "counts.json"),
    JSON.stringify({
      schemaVersion: 1,
      days: { "2019-01-01": {}, ...h.counts.days },
    }),
  );
  prepareStorage(h.target);
  const db = new DatabaseSync(join(h.target, "records.sqlite"));
  db.exec("DROP TABLE legacy_days");
  db.close();
  assert.throws(() => {
    const opened = new StorageStore(h.target);
    opened.close();
  }, /MIGRATION_SCHEMA/);
  const inspect = new DatabaseSync(join(h.target, "records.sqlite"), {
    readOnly: true,
  });
  try {
    assert.equal(
      inspect
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='legacy_days'",
        )
        .get()?.n,
      0,
    );
  } finally {
    inspect.close();
  }
  assert.equal(existsSync(join(h.root, "counts.json")), true);
});
test("persisted migration identity refuses a missing source marker instead of treating the DB as unmigrated", (t) => {
  const h = fixture(t);
  prepareStorage(h.target);
  rmSync(join(h.target, "source.json"));
  assert.throws(() => {
    const opened = new StorageStore(h.target);
    opened.close();
  }, /MIGRATION_SOURCE_MISSING/);
  assert.equal(existsSync(join(h.root, "counts.json")), true);
});
