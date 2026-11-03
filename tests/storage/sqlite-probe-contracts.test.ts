import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  connect,
  write,
  reset,
  migrate,
} from "../../validation/probes/sqlite/store.cjs";
import { assertRuntime } from "../../validation/probes/sqlite/runtime.cjs";

function fixture() {
  const base = resolve(".tools/tests");
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, "sqlite-regression-"));
}
function batch(id: string, extra = {}) {
  return {
    generation: 1,
    id,
    day: "2026-10-19",
    operation: "W03",
    mouse: 1,
    key: 0,
    ...extra,
  };
}
const counts = Buffer.from(
  '{"schemaVersion":1,"days":{"2026-10-19":{"W03":{"mouse":2,"key":1}}}}\r\n',
);
const settings = Buffer.from(
  '{"schemaVersion":1,"muted":["W03"],"opened":true}\r\n',
);

test("SQLite移行は旧repositoryの未作成JSONの既定値を引き継ぎ、欠落も保持する", () => {
  for (const present of [[], ["counts.json"], ["settings.json"]]) {
    const root = fixture();
    for (const file of present)
      writeFileSync(
        join(root, file),
        file === "counts.json" ? counts : settings,
      );
    const first = migrate(root);
    assert.equal(first.rows, present.includes("counts.json") ? 1 : 0);
    const db = connect(join(root, "migrated.sqlite"));
    try {
      assert.equal(
        db.prepare("SELECT value FROM meta WHERE name='opened'").get()?.value,
        String(present.includes("settings.json")),
      );
      assert.equal(
        db.prepare("SELECT state FROM settings WHERE operation='W03'").get()
          ?.state,
        present.includes("settings.json") ? "excluded" : "learning",
      );
    } finally {
      db.close();
    }
    assert.deepEqual(migrate(root), first);
    for (const file of ["counts.json", "settings.json"]) {
      assert.equal(existsSync(join(root, file)), present.includes(file));
      if (present.includes(file))
        assert.deepEqual(
          readFileSync(join(root, file)),
          file === "counts.json" ? counts : settings,
        );
    }
  }
});

test("SQLiteの全削除はledgerも空にし、旧世代を拒否したまま新世代を記録する", () => {
  const db = connect(join(fixture(), "records.sqlite"), { create: true });
  try {
    write(db, batch("history"));
    db.prepare("INSERT INTO settings VALUES (?,?)").run("W03", "excluded");
    reset(db);
    for (const table of ["days", "counts", "writes"])
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n,
        0,
        table,
      );
    assert.equal(
      db.prepare("SELECT state FROM settings WHERE operation='W03'").get()
        ?.state,
      "excluded",
    );
    assert.throws(() => write(db, batch("history")), /STALE_GENERATION/);
    assert.throws(() => write(db, batch("late")), /STALE_GENERATION/);
    assert.equal(write(db, batch("history", { generation: 2 })), "written");
    assert.equal(write(db, batch("history", { generation: 2 })), "duplicate");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM writes").get()?.n, 1);
  } finally {
    db.close();
  }
});

test("SQLiteの新規書込は実在しない日付をDBとledgerへ保存しない", () => {
  const db = connect(join(fixture(), "records.sqlite"), { create: true });
  try {
    for (const day of ["2026-02-30", "2025-02-29", "2026-13-01"]) {
      assert.throws(() => write(db, batch(day, { day })));
    }
    for (const table of ["days", "counts", "writes"])
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n,
        0,
      );
    assert.equal(write(db, batch("leap", { day: "2024-02-29" })), "written");
  } finally {
    db.close();
  }
});

test("SQLite移行は未所有の空DBと将来schemaを初期化して上書きしない", () => {
  for (const version of [0, 99]) {
    const root = fixture();
    writeFileSync(join(root, "counts.json"), counts);
    writeFileSync(join(root, "settings.json"), settings);
    const file = join(root, "migrated.sqlite");
    const db = new DatabaseSync(file);
    db.exec(`PRAGMA user_version=${version}`);
    db.close();
    const before = readFileSync(file);
    assert.throws(() => migrate(root), /DB_VERSION_UNSUPPORTED/);
    assert.deepEqual(readFileSync(file), before);
    assert.equal(existsSync(join(root, "active.json")), false);
  }
});

test("SQLite移行は自分の初期schema作成中断だけを再開する", () => {
  for (const stop of [
    "marker-before-write",
    "marker-before-publish",
    "schema-before-commit",
  ]) {
    const root = fixture();
    writeFileSync(join(root, "counts.json"), counts);
    writeFileSync(join(root, "settings.json"), settings);
    assert.throws(
      () =>
        migrate(root, (phase: string) => {
          if (phase === stop)
            throw new Error("fixture initialization interrupted");
        }),
      /fixture initialization interrupted/,
    );
    assert.equal(existsSync(join(root, "active.json")), false);
    assert.equal(
      existsSync(join(root, "migrated.sqlite.initializing.json")),
      stop === "schema-before-commit",
    );
    assert.equal(migrate(root).rows, 1);
    assert.equal(
      existsSync(join(root, "migrated.sqlite.initializing.json")),
      false,
    );
    assert.deepEqual(readFileSync(join(root, "counts.json")), counts);
    assert.deepEqual(readFileSync(join(root, "settings.json")), settings);
  }
});

test("SQLite初期化の所有情報があっても原本変更や空でないDBは上書きしない", () => {
  for (const change of ["source", "schema"]) {
    const root = fixture();
    writeFileSync(join(root, "counts.json"), counts);
    writeFileSync(join(root, "settings.json"), settings);
    assert.throws(
      () =>
        migrate(root, (phase: string) => {
          if (phase === "schema-before-commit") throw new Error("interrupted");
        }),
      /interrupted/,
    );
    const file = join(root, "migrated.sqlite");
    if (change === "source")
      writeFileSync(
        join(root, "counts.json"),
        Buffer.concat([counts, Buffer.from(" ")]),
      );
    else {
      const db = new DatabaseSync(file);
      db.exec("CREATE TABLE foreign_data (value TEXT)");
      db.close();
    }
    const before = readFileSync(file);
    assert.throws(() => migrate(root));
    assert.deepEqual(readFileSync(file), before);
    assert.equal(existsSync(join(root, "active.json")), false);
  }
});

test("SQLite配布物の検証は現在のElectron固定版と異なるruntimeを拒否する", () => {
  const pinned = JSON.parse(readFileSync("package.json", "utf8"))
    .devDependencies.electron;
  assert.doesNotThrow(() =>
    assertRuntime({ electron: pinned, packaged: true }, pinned, true),
  );
  assert.throws(
    () =>
      assertRuntime({ electron: "0.0.0-stale", packaged: true }, pinned, true),
    /runtime differs/,
  );
  assert.throws(() =>
    assertRuntime({ electron: pinned, packaged: false }, pinned, true),
  );
});
