// Research-only storage protocol. Product storage remains JsonRepository (#15/#16 own integration).
const { DatabaseSync } = require("node:sqlite");
const {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  openSync,
  fsyncSync,
  closeSync,
  unlinkSync,
} = require("node:fs");
const { join } = require("node:path");
const { createHash } = require("node:crypto");
const assert = require("node:assert/strict");

const legacyIds = Array.from(
  { length: 11 },
  (_, i) => `W${String(i + 1).padStart(2, "0")}`,
);
const releaseIds = [...legacyIds.filter((id) => id !== "W09"), "W12", "W13"];
const hash = (bytes) =>
  bytes === null ? "absent" : createHash("sha256").update(bytes).digest("hex");
function optionalBytes(file) {
  try {
    return readFileSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function validDay(day) {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(day + "T00:00:00Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day
  );
}
function transaction(db, action) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}
function connect(
  file,
  {
    create = false,
    readOnly = false,
    resumeInitialization = false,
    checkpoint = () => {},
  } = {},
) {
  if (!create && !existsSync(file)) throw new Error("DB_MISSING");
  const db = new DatabaseSync(file, { readOnly });
  try {
    db.exec("PRAGMA busy_timeout=1000");
    assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
    const version = db.prepare("PRAGMA user_version").get().user_version;
    if (version === 0 && (create || resumeInitialization)) {
      // A known initialization may be resumed only if its schema transaction rolled back completely.
      assert.equal(
        db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema").get().n,
        0,
        "DB_INITIALIZATION_NOT_EMPTY",
      );
      transaction(db, () => {
        db.exec(`
        CREATE TABLE meta (name TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
        INSERT INTO meta VALUES ('generation', '1');
        CREATE TABLE days (day TEXT PRIMARY KEY) STRICT;
        CREATE TABLE counts (day TEXT NOT NULL, operation TEXT NOT NULL,
          mouse INTEGER NOT NULL CHECK(mouse>=0), key INTEGER NOT NULL CHECK(key>=0),
          PRIMARY KEY(day, operation)) STRICT;
        CREATE TABLE settings (operation TEXT PRIMARY KEY, state TEXT NOT NULL) STRICT;
        CREATE TABLE writes (generation INTEGER NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
          PRIMARY KEY(generation,id)) STRICT;
        CREATE TABLE capacity_fixture (value BLOB) STRICT;
        PRAGMA user_version=1;
        `);
        checkpoint("schema-before-commit");
      });
    } else if (version !== 1) throw new Error("DB_VERSION_UNSUPPORTED");
    if (!readOnly) {
      assert.equal(
        db.prepare("PRAGMA journal_mode=WAL").get().journal_mode,
        "wal",
      );
      db.exec("PRAGMA synchronous=FULL");
      assert.equal(db.prepare("PRAGMA synchronous").get().synchronous, 2);
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
function range(db, from, to) {
  return db
    .prepare(
      "SELECT * FROM counts WHERE day>=? AND day<=? ORDER BY day,operation",
    )
    .all(from, to);
}
function write(db, batch, checkpoint = () => {}) {
  // Ordered field encoding: the same ID with different contents must fail, never silently deduplicate.
  const payload = JSON.stringify([
    batch.day,
    batch.operation,
    batch.mouse,
    batch.key,
  ]);
  assert.ok(validDay(batch.day), "INVALID_DAY");
  assert.ok(releaseIds.includes(batch.operation));
  for (const count of [batch.mouse, batch.key])
    assert.ok(Number.isSafeInteger(count) && count >= 0);
  assert.ok(Number.isSafeInteger(batch.generation) && batch.generation > 0);
  assert.ok(typeof batch.id === "string" && batch.id.length > 0);
  return transaction(db, () => {
    const generation = Number(
      db.prepare("SELECT value FROM meta WHERE name='generation'").get().value,
    );
    if (batch.generation !== generation) throw new Error("STALE_GENERATION");
    const previous = db
      .prepare("SELECT payload FROM writes WHERE generation=? AND id=?")
      .get(batch.generation, batch.id);
    if (previous) {
      assert.equal(previous.payload, payload, "WRITE_ID_CONFLICT");
      return "duplicate";
    }
    db.prepare("INSERT INTO writes VALUES (?,?,?)").run(
      batch.generation,
      batch.id,
      payload,
    );
    db.prepare("INSERT OR IGNORE INTO days VALUES (?)").run(batch.day);
    db.prepare(
      `INSERT INTO counts VALUES (?,?,?,?) ON CONFLICT(day,operation)
      DO UPDATE SET mouse=mouse+excluded.mouse, key=key+excluded.key`,
    ).run(batch.day, batch.operation, batch.mouse, batch.key);
    const saved = db
      .prepare("SELECT mouse,key FROM counts WHERE day=? AND operation=?")
      .get(batch.day, batch.operation);
    assert.ok(
      Number.isSafeInteger(saved.mouse) && Number.isSafeInteger(saved.key),
      "COUNTER_OVERFLOW",
    );
    checkpoint("before-commit");
    return "written";
  });
}
function reset(db) {
  return transaction(db, () => {
    db.exec(
      "DELETE FROM counts; DELETE FROM days; DELETE FROM writes; UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE name='generation'",
    );
  });
}
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function fields(value, keys) {
  return object(value) && Object.keys(value).every((key) => keys.includes(key));
}
function legacy(root) {
  const countsBytes = optionalBytes(join(root, "counts.json"));
  const settingsBytes = optionalBytes(join(root, "settings.json"));
  const counts =
    countsBytes === null
      ? { schemaVersion: 1, days: {} }
      : JSON.parse(countsBytes.toString("utf8"));
  const settings =
    settingsBytes === null
      ? { schemaVersion: 1, muted: [], opened: false }
      : JSON.parse(settingsBytes.toString("utf8"));
  assert.ok(
    fields(counts, ["schemaVersion", "days"]) &&
      counts.schemaVersion === 1 &&
      object(counts.days),
    "LEGACY_COUNTS_VERSION",
  );
  assert.ok(
    fields(settings, ["schemaVersion", "muted", "opened"]) &&
      settings.schemaVersion === 1 &&
      typeof settings.opened === "boolean" &&
      Array.isArray(settings.muted) &&
      settings.muted.every((id) => legacyIds.includes(id)) &&
      new Set(settings.muted).size === settings.muted.length,
    "LEGACY_SETTINGS",
  );
  const rows = [];
  for (const [day, entries] of Object.entries(counts.days)) {
    assert.ok(validDay(day), "INVALID_DAY");
    assert.ok(object(entries));
    for (const [id, counter] of Object.entries(entries)) {
      assert.ok(legacyIds.includes(id) && fields(counter, ["mouse", "key"]));
      assert.ok(
        [counter.mouse, counter.key].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        ),
      );
      rows.push({ day, operation: id, mouse: counter.mouse, key: counter.key });
    }
  }
  rows.sort(
    (a, b) =>
      a.day.localeCompare(b.day) || a.operation.localeCompare(b.operation),
  );
  return {
    countsBytes,
    settingsBytes,
    countsHash: hash(countsBytes),
    settingsHash: hash(settingsBytes),
    days: Object.keys(counts.days).sort(),
    rows,
    settings,
  };
}
function verifyMigration(db, source) {
  assert.deepEqual(
    JSON.parse(JSON.stringify(range(db, "0000-01-01", "9999-12-31"))),
    source.rows,
  );
  assert.deepEqual(
    db
      .prepare("SELECT day FROM days ORDER BY day")
      .all()
      .map((r) => r.day),
    source.days,
  );
  const states = db
    .prepare("SELECT operation,state FROM settings ORDER BY operation")
    .all();
  assert.deepEqual(
    JSON.parse(JSON.stringify(states)),
    [...new Set([...releaseIds, ...source.settings.muted])]
      .sort()
      .map((operation) => ({
        operation,
        state: source.settings.muted.includes(operation)
          ? "excluded"
          : "learning",
      })),
  );
  for (const [name, value] of Object.entries({
    countsHash: source.countsHash,
    settingsHash: source.settingsHash,
    opened: String(source.settings.opened),
  })) {
    assert.equal(
      db.prepare("SELECT value FROM meta WHERE name=?").get(name)?.value,
      value,
    );
  }
}
/** @param {string} root @param {(phase: string) => void} [checkpoint] */
function migrate(root, checkpoint = () => {}) {
  const source = legacy(root); // Validate before creating any destination.
  const file = join(root, "migrated.sqlite");
  const pointer = join(root, "active.json");
  const initializing = join(root, "migrated.sqlite.initializing.json");
  const identity = {
    schemaVersion: 1,
    file: "migrated.sqlite",
    countsHash: source.countsHash,
    settingsHash: source.settingsHash,
  };
  if (existsSync(pointer)) {
    const active = JSON.parse(readFileSync(pointer, "utf8"));
    assert.deepEqual(active, identity);
    assert.ok(existsSync(file), "ACTIVE_DB_MISSING");
  }
  if (!existsSync(file) && !existsSync(initializing)) {
    // Persist ownership before SQLite can create a destination, so an initial crash is distinguishable
    // from an arbitrary pre-existing version-0 DB. Source hashes also fence changed/missing originals.
    const temporary = initializing + ".tmp";
    const handle = openSync(temporary, "w");
    try {
      checkpoint("marker-before-write");
      writeFileSync(handle, JSON.stringify(identity));
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    checkpoint("marker-before-publish");
    renameSync(temporary, initializing);
  }
  const ownedInitialization = !existsSync(pointer) && existsSync(initializing);
  if (ownedInitialization)
    assert.deepEqual(JSON.parse(readFileSync(initializing, "utf8")), identity);
  const db = connect(file, {
    create: !existsSync(file),
    resumeInitialization: ownedInitialization,
    checkpoint,
  });
  try {
    if (ownedInitialization) unlinkSync(initializing); // Schema is now committed; future attempts use version 1.
    if (!db.prepare("SELECT value FROM meta WHERE name='countsHash'").get()) {
      transaction(db, () => {
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM counts").get().n, 0);
        for (const day of source.days)
          db.prepare("INSERT INTO days VALUES (?)").run(day);
        for (const r of source.rows)
          db.prepare("INSERT INTO counts VALUES (?,?,?,?)").run(
            r.day,
            r.operation,
            r.mouse,
            r.key,
          );
        for (const id of new Set([...releaseIds, ...source.settings.muted]))
          db.prepare("INSERT INTO settings VALUES (?,?)").run(
            id,
            source.settings.muted.includes(id) ? "excluded" : "learning",
          );
        for (const [name, value] of Object.entries({
          countsHash: source.countsHash,
          settingsHash: source.settingsHash,
          opened: String(source.settings.opened),
        }))
          db.prepare("INSERT INTO meta VALUES (?,?)").run(name, value);
        checkpoint("migration-before-commit");
      });
    }
    verifyMigration(db, source);
  } finally {
    db.close();
  }
  // Reopen from disk and compare every row before the switch.
  const verified = connect(file);
  try {
    verifyMigration(verified, source);
  } finally {
    verified.close();
  }
  checkpoint("migration-before-switch");
  assert.deepEqual(
    optionalBytes(join(root, "counts.json")),
    source.countsBytes,
    "SOURCE_CHANGED",
  );
  assert.deepEqual(
    optionalBytes(join(root, "settings.json")),
    source.settingsBytes,
    "SOURCE_CHANGED",
  );
  const active = identity;
  const temporary = join(root, "active.json.tmp");
  writeFileSync(temporary, JSON.stringify(active));
  const handle = openSync(temporary, "r+");
  try {
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  renameSync(temporary, pointer);
  checkpoint("migration-after-switch");
  return { rows: source.rows.length, days: source.days.length, ...active };
}
module.exports = { connect, range, write, reset, migrate, transaction, hash };
