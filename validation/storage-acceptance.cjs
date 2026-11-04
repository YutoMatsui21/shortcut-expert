const assert = require("node:assert/strict");
const fs = require("node:fs");
const { join, resolve } = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const { DatabaseSync } = require("node:sqlite");
const { Worker } = require("node:worker_threads");
const { SqliteRepository, StorageStore, readLegacy, DurableCoach } = require(
  process.env.COACH_V02_ENTRY,
);
const base = process.env.COACH_V02_OUTPUT;
const worker = process.env.COACH_V02_WORKER;
const today = "2026-10-21";
const rows = {
  "2019-01-01": {},
  "2020-01-02": { W01: { mouse: 9, key: 4 }, W09: { mouse: 80, key: 90 } },
  "2026-10-20": { W03: { mouse: 3, key: 2 }, W11: { mouse: 0, key: 0 } },
};
function fixture(name, legacy = false) {
  const root = join(base, name);
  fs.mkdirSync(root);
  if (legacy) {
    fs.writeFileSync(
      join(root, "counts.json"),
      "  " + JSON.stringify({ schemaVersion: 1, days: rows }) + "\n",
    );
    fs.writeFileSync(
      join(root, "settings.json"),
      JSON.stringify({ schemaVersion: 1, muted: ["W03", "W09"], opened: true }),
    );
  }
  return root;
}
const dbfile = (root) => join(root, "records-v1/records.sqlite");
function sql(root, statement) {
  const db = new DatabaseSync(dbfile(root));
  try {
    db.exec(statement);
  } finally {
    db.close();
  }
}
const mutation = (repo, sequence = 1, extra = {}) => ({
  epoch: 1,
  writeSession: repo.session,
  sequence,
  today,
  count: { day: today, operation: "W03", origin: "key" },
  coverage: [
    {
      day: today,
      operation: "W03",
      value: {
        knowledge: "observed",
        activeMs: 100,
        gap: true,
        capabilityRevision: "v02-fixture",
      },
    },
  ],
  ...extra,
});
async function using(root, action) {
  const repo = new SqliteRepository(root, worker);
  try {
    return await action(repo);
  } finally {
    await repo.close();
  }
}
async function verifyLegacy(root, repo) {
  for (const [day, value] of Object.entries(rows)) {
    const range = await repo.query(day, day);
    assert.deepEqual(range.counts, { [day]: value });
    const expected = Object.fromEntries(
      Object.keys(value).map((id) => [
        id,
        {
          knowledge: "legacy-unknown",
          activeMs: 0,
          gap: true,
          capabilityRevision: "legacy-v1",
        },
      ]),
    );
    assert.deepEqual(
      range.coverage,
      Object.keys(expected).length ? { [day]: expected } : {},
    );
  }
  const state = await repo.load(today);
  const ids = Array.from(
    { length: 14 },
    (_, i) => "W" + String(i + 1).padStart(2, "0"),
  );
  assert.deepEqual(state.settings, {
    muted: ["W03", "W09"],
    opened: true,
    states: Object.fromEntries(
      ids.map((id) => [
        id,
        ["W03", "W09"].includes(id) ? "excluded" : "learning",
      ]),
    ),
  });
}
async function child(root, action) {
  const processChild = spawn(
    process.execPath,
    [__filename, "--child", root, action],
    {
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "",
    stderr = "";
  processChild.stdout.on("data", (value) => {
    stdout += value;
  });
  processChild.stderr.on("data", (value) => {
    stderr += value;
  });
  const exited = once(processChild, "exit");
  const timer = setTimeout(() => processChild.kill(), 20_000);
  try {
    await new Promise((done, fail) => {
      const listener = () => {
        if (stdout.includes("V02_CHILD_READY")) {
          processChild.stdout.off("data", listener);
          done();
        }
      };
      processChild.stdout.on("data", listener);
      processChild.once("error", fail);
      exited.then(
        () => fail(new Error("child exited: " + stdout + stderr)),
        fail,
      );
    });
    processChild.kill("SIGKILL");
    await exited;
  } finally {
    clearTimeout(timer);
    if (processChild.exitCode === null) processChild.kill();
  }
}
async function childMain(root, action) {
  if (action === "writer") {
    await using(root, async (repo) => {
      await repo.load(today);
      await repo.commit(mutation(repo));
      console.log("V02_CHILD_READY");
      await new Promise(() => {});
    });
  } else {
    const directory = join(root, "migration-v1");
    fs.mkdirSync(directory);
    fs.writeFileSync(
      join(directory, "source.json"),
      JSON.stringify({ schemaVersion: 1, identity: readLegacy(root).identity }),
    );
    const store = new StorageStore(directory, "staging");
    if (action === "staging-committed") store.importLegacy(readLegacy(root));
    store.close();
    console.log("V02_CHILD_READY");
    setInterval(() => {}, 1000);
  }
}
async function suite() {
  assert.equal(process.versions.electron, process.env.COACH_V02_ELECTRON);
  assert.ok(fs.existsSync(worker));
  const results = [];
  async function test(name, action) {
    const started = Date.now();
    try {
      await action();
      results.push({ name, passed: true, elapsedMs: Date.now() - started });
      console.log("PASS " + name);
    } catch (error) {
      results.push({ name, passed: false, error: error.stack });
      console.error("FAIL " + name + "\n" + error.stack);
    }
    fs.writeFileSync(
      join(base, "results.json"),
      JSON.stringify(
        {
          runtime: process.versions,
          platform: process.platform,
          windows: require("node:os").release(),
          results,
        },
        null,
        2,
      ),
    );
  }
  await test("bundled Worker write/reopen and all-row legacy migration, source bytes, >30 days, non-additive restart", async () => {
    const root = fixture("migration", true);
    const originals = ["counts.json", "settings.json"].map((name) =>
      fs.readFileSync(join(root, name)),
    );
    for (let i = 0; i < 2; i++)
      await using(root, async (repo) => {
        await repo.load(today);
        await verifyLegacy(root, repo);
      });
    ["counts.json", "settings.json"].forEach((name, i) =>
      assert.deepEqual(fs.readFileSync(join(root, name)), originals[i]),
    );
    await using(root, async (repo) => {
      await repo.load(today);
      await repo.commit(mutation(repo));
      const saved = await repo.query(today, today);
      assert.equal(saved.counts[today].W03.key, 1);
      assert.equal(saved.coverage[today].W03.activeMs, 100);
    });
    await using(root, async (repo) => {
      assert.equal((await repo.load(today)).counts[today].W03.key, 1);
    });
  });
  await test("real Worker rollback preserves counts, coverage, checkpoint and settings; same delta retry once", async () => {
    const root = fixture("rollback");
    await using(root, async (repo) => {
      await repo.load(today);
      await repo.commit(mutation(repo));
      const before = await repo.load(today);
      sql(
        root,
        "CREATE TRIGGER v02_fail BEFORE INSERT ON coverage BEGIN SELECT RAISE(ABORT,'V02 rollback'); END",
      );
      await assert.rejects(repo.commit(mutation(repo, 2)), /STORAGE_FAILED/);
      assert.deepEqual(await repo.load(today), before);
      sql(root, "DROP TRIGGER v02_fail");
      await repo.commit(mutation(repo, 2));
      await repo.commit(mutation(repo, 2));
      assert.equal((await repo.load(today)).counts[today].W03.key, 2);
    });
  });
  await test("external SQLite writer lock rejects commit without losing the pending delta", async () => {
    const root = fixture("sqlite-lock");
    await using(root, async (repo) => {
      await repo.load(today);
      const db = new DatabaseSync(dbfile(root));
      try {
        db.exec("BEGIN IMMEDIATE");
        await assert.rejects(repo.commit(mutation(repo)), /STORAGE_FAILED/);
        db.exec("ROLLBACK");
        await repo.commit(mutation(repo));
        assert.equal((await repo.load(today)).counts[today].W03.key, 1);
      } finally {
        db.close();
      }
    });
  });
  await test("authority wins over conflicting old directory; separate fixture roots never share rows", async () => {
    const root = fixture("directory-conflict", true),
      isolated = fixture("directory-isolated");
    await using(root, async (repo) => {
      await repo.load(today);
    });
    fs.writeFileSync(join(root, "counts.json"), "invalid old document");
    fs.mkdirSync(join(root, "migration-v1"));
    await using(root, async (repo) => {
      await repo.load(today);
      await verifyLegacy(root, repo);
    });
    assert.equal(
      fs.readFileSync(join(root, "counts.json"), "utf8"),
      "invalid old document",
    );
    await using(isolated, async (repo) => {
      assert.deepEqual((await repo.load(today)).counts, {});
    });
  });
  await test("commit ACK dropped at Worker message boundary, reconnect and retry; session/sequence/epoch fences", async () => {
    const root = fixture("ack");
    await using(root, async (repo) => {
      await repo.load(today);
      const active = Reflect.get(repo, "worker");
      assert.ok(active instanceof Worker);
      const emit = active.emit.bind(active);
      active.emit = (event, ...args) => {
        if (event === "message" && args[0]?.ok) {
          active.emit = emit;
          void active.terminate();
          return false;
        }
        return emit(event, ...args);
      };
      const batch = mutation(repo);
      await assert.rejects(repo.commit(batch), /STORAGE_RESPONSE_UNKNOWN/);
      await repo.reconnect();
      await repo.commit(batch);
      await repo.commit(batch);
      assert.equal((await repo.load(today)).counts[today].W03.key, 1);
      await assert.rejects(
        repo.commit({ ...batch, count: { ...batch.count, origin: "mouse" } }),
      );
      await assert.rejects(repo.commit(mutation(repo, 3)));
      await assert.rejects(
        repo.commit(mutation(repo, 2, { writeSession: "stale-session" })),
      );
      const reset = mutation(repo, 2, {
        count: undefined,
        coverage: [],
        reset: true,
      });
      await repo.commit(reset);
      await repo.reconnect();
      await repo.commit(reset);
      assert.equal((await repo.load(today)).epoch, 2);
      await assert.rejects(repo.commit(mutation(repo, 3)));
    });
  });
  await test("same-directory writer rejected; killed Main releases ownership and committed rows survive", async () => {
    const root = fixture("writer");
    await using(root, async (repo) => {
      await repo.load(today);
      await using(root, async (second) => {
        await assert.rejects(second.load(today), /WRITER_ALREADY_ACTIVE/);
      });
    });
    await child(root, "writer");
    await using(root, async (repo) => {
      assert.equal((await repo.load(today)).counts[today].W03.key, 1);
    });
  });
  for (const phase of ["staging-schema", "staging-committed"])
    await test(
      "process interruption at " + phase + " resumes without addition",
      async () => {
        const root = fixture(phase, true);
        const original = fs.readFileSync(join(root, "counts.json"));
        await child(root, phase);
        assert.equal(fs.existsSync(join(root, "records-v1")), false);
        await using(root, async (repo) => {
          await repo.load(today);
          await verifyLegacy(root, repo);
        });
        assert.equal(fs.existsSync(join(root, "migration-v1")), false);
        assert.deepEqual(fs.readFileSync(join(root, "counts.json")), original);
      },
    );
  await test("uncommitted SQLite transaction killed; bundled Worker reopens prior committed state", async () => {
    const root = fixture("transaction-kill");
    await using(root, async (repo) => {
      await repo.load(today);
      await repo.commit(mutation(repo));
    });
    const writer = new Worker(
      `const {parentPort,workerData}=require('node:worker_threads'); const {DatabaseSync}=require('node:sqlite');
      const db=new DatabaseSync(workerData); db.exec('BEGIN IMMEDIATE; UPDATE counts SET key=999'); parentPort.postMessage('held'); setInterval(()=>{},1000);`,
      { eval: true, workerData: dbfile(root) },
    );
    try {
      await once(writer, "message");
    } finally {
      await writer.terminate();
    }
    await using(root, async (repo) => {
      assert.equal((await repo.load(today)).counts[today].W03.key, 1);
    });
  });
  await test("unknown schema/corrupt/missing authority never import old JSON or replace original bytes", async () => {
    for (const kind of ["future", "corrupt", "missing"]) {
      const root = fixture("authority-" + kind, true);
      await using(root, async (repo) => {
        await repo.load(today);
      });
      if (kind === "future") sql(root, "PRAGMA user_version=99");
      if (kind === "corrupt")
        fs.writeFileSync(dbfile(root), "V02 corrupt database");
      if (kind === "missing") fs.unlinkSync(dbfile(root));
      const original = fs.readFileSync(join(root, "counts.json"));
      const dbBytes = kind === "missing" ? null : fs.readFileSync(dbfile(root));
      await using(root, async (repo) => {
        await assert.rejects(repo.load(today), /STORAGE_OPEN_FAILED/);
      });
      assert.deepEqual(fs.readFileSync(join(root, "counts.json")), original);
      if (dbBytes) assert.deepEqual(fs.readFileSync(dbfile(root)), dbBytes);
      else assert.equal(fs.existsSync(dbfile(root)), false);
    }
  });
  await test("invalid legacy and altered committed staging fail without activation or original overwrite", async () => {
    const invalid = fixture("invalid-legacy", true);
    fs.writeFileSync(
      join(invalid, "counts.json"),
      '{"schemaVersion":99,"days":{}}',
    );
    const original = fs.readFileSync(join(invalid, "counts.json"));
    await using(invalid, async (repo) => {
      await assert.rejects(repo.load(today));
    });
    assert.deepEqual(fs.readFileSync(join(invalid, "counts.json")), original);
    assert.equal(fs.existsSync(join(invalid, "records-v1")), false);
    const root = fixture("altered-stage", true);
    await child(root, "staging-committed");
    const db = new DatabaseSync(join(root, "migration-v1/records.sqlite"));
    try {
      db.exec(
        "UPDATE counts SET mouse=mouse+1 WHERE operation='W01'; UPDATE counts SET mouse=mouse-1 WHERE operation='W09'",
      );
    } finally {
      db.close();
    }
    await using(root, async (repo) => {
      await assert.rejects(repo.load(today));
    });
    assert.equal(fs.existsSync(join(root, "records-v1")), false);
    assert.deepEqual(readLegacy(root).counts, rows);
  });
  await test("purge fails after deletion commit; failure remains visible, restart completes cleanup with resurrection zero", async () => {
    const root = fixture("purge", true);
    let settings;
    await using(root, async (repo) => {
      settings = (await repo.load(today)).settings;
      fs.unlinkSync(join(root, "counts.json"));
      fs.mkdirSync(join(root, "counts.json"));
      const reset = mutation(repo, 1, {
        count: undefined,
        coverage: [],
        reset: true,
      });
      await assert.rejects(repo.commit(reset));
      assert.deepEqual(
        (await repo.query("2020-01-02", "2020-01-02")).counts,
        {},
      );
    });
    await using(root, async (repo) => {
      await assert.rejects(repo.load(today));
    });
    fs.rmdirSync(join(root, "counts.json"));
    fs.writeFileSync(
      join(root, "counts.json"),
      JSON.stringify({ schemaVersion: 1, days: rows }),
    );
    fs.writeFileSync(join(root, "counts.json.tmp"), "old synthetic copy");
    fs.mkdirSync(join(root, "migration-v1"));
    fs.writeFileSync(
      join(root, "migration-v1/records.sqlite"),
      "synthetic staging",
    );
    await using(root, async (repo) => {
      const saved = await repo.load(today);
      assert.equal(saved.epoch, 2);
      assert.deepEqual(saved.settings, settings);
      for (const day of Object.keys(rows)) {
        const range = await repo.query(day, day);
        assert.deepEqual(range.counts, {});
        assert.deepEqual(range.coverage, {});
      }
    });
    for (const name of [
      "counts.json",
      "settings.json",
      "counts.json.tmp",
      "migration-v1",
    ])
      assert.equal(fs.existsSync(join(root, name)), false);
    await using(root, async (repo) => {
      assert.deepEqual((await repo.load(today)).counts, {});
    });
  });
  await test("SQLite SQLITE_FULL (page limit, not volume exhaustion) rolls back bundled Store transaction", async () => {
    const root = fixture("sqlite-full");
    const target = join(root, "records-v1");
    fs.mkdirSync(target);
    const store = new StorageStore(target);
    try {
      store.claim("v02-full");
      const db = Reflect.get(store, "db");
      db.exec(
        "CREATE TABLE v02_fill (payload BLOB); CREATE TRIGGER v02_full BEFORE INSERT ON coverage BEGIN INSERT INTO v02_fill VALUES(zeroblob(1048576)); END",
      );
      const pages = db.prepare("PRAGMA page_count").get().page_count;
      db.exec("PRAGMA max_page_count=" + pages);
      const batch = mutation({ session: "v02-full" });
      assert.throws(
        () => store.commit(batch),
        (error) => error.errcode === 13,
      );
      assert.deepEqual(store.load(today).counts, {});
      assert.deepEqual(store.load(today).coverage, {});
      db.exec("DROP TRIGGER v02_full; PRAGMA max_page_count=1073741823");
      store.commit(batch);
      store.commit(batch);
      assert.equal(store.load(today).counts[today].W03.key, 1);
    } finally {
      store.close();
    }
    await using(root, async (repo) => {
      assert.equal((await repo.load(today)).counts[today].W03.key, 1);
    });
  });
  await test("bundled Worker propagates real SQLITE_FULL from connection page limit; reconnect retries once", async () => {
    const root = fixture("worker-full");
    await using(root, async (repo) => {
      await repo.load(today);
    });
    sql(
      root,
      "CREATE TABLE v02_fill(payload BLOB); CREATE TRIGGER v02_full BEFORE INSERT ON coverage BEGIN INSERT INTO v02_fill VALUES(zeroblob(1048576)); END",
    );
    // Fault injection at the SQLite boundary only: run the unmodified packaged
    // Worker, setting its actual connection's page limit before Store uses it.
    const bootstrap = join(root, "limited-worker.cjs");
    fs.writeFileSync(
      bootstrap,
      `const sqlite=require('node:sqlite'); const Original=sqlite.DatabaseSync;
      sqlite.DatabaseSync=class extends Original { constructor(...args) { super(...args); const pages=this.prepare('PRAGMA page_count').get().page_count; this.exec('PRAGMA max_page_count='+pages); } };
      require(${JSON.stringify(worker)});`,
    );
    const limited = new Worker(bootstrap, {
      workerData: { root: join(root, "records-v1") },
    });
    const request = async (id, action, ...args) => {
      const answer = once(limited, "message");
      limited.postMessage({ id, action, args });
      return (await answer)[0];
    };
    const batch = mutation({ session: "v02-worker-full" });
    try {
      assert.deepEqual((await once(limited, "message"))[0], { ready: true });
      assert.equal((await request(1, "claim", batch.writeSession)).ok, true);
      assert.equal((await request(2, "commit", batch)).ok, false);
      const state = (await request(3, "load", today)).result;
      assert.deepEqual(state.counts, {});
      assert.deepEqual(state.coverage, {});
    } finally {
      await limited.terminate();
    }
    sql(root, "DROP TRIGGER v02_full");
    // Reconnect the packaged Worker without a new Main session claim.
    const restored = new Worker(worker, {
      workerData: { root: join(root, "records-v1") },
    });
    const send = async (id, action, ...args) => {
      const reply = once(restored, "message");
      restored.postMessage({ id, action, args });
      return (await reply)[0];
    };
    try {
      assert.equal((await once(restored, "message"))[0].ready, true);
      assert.equal((await send(1, "commit", batch)).ok, true);
      assert.equal((await send(2, "commit", batch)).ok, true);
      assert.equal(
        (await send(3, "load", today)).result.counts[today].W03.key,
        1,
      );
    } finally {
      await restored.terminate();
    }
  });
  await test("Windows deny-write ACL blocks packaged Worker open and preserves data; finally restores ACL", async () => {
    assert.equal(process.platform, "win32");
    const root = fixture("permission");
    await using(root, async (repo) => {
      await repo.load(today);
      await repo.commit(mutation(repo));
    });
    const target = join(root, "records-v1");
    const original = fs.readFileSync(dbfile(root));
    const account = execFileSync("whoami.exe", [], {
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    try {
      execFileSync("icacls.exe", [target, "/deny", account + ":(OI)(CI)(W)"], {
        windowsHide: true,
      });
      await using(root, async (repo) => {
        await assert.rejects(repo.load(today));
      });
    } finally {
      execFileSync("icacls.exe", [target, "/remove:d", account], {
        windowsHide: true,
      });
    }
    assert.deepEqual(fs.readFileSync(dbfile(root)), original);
    await using(root, async (repo) => {
      assert.equal((await repo.load(today)).counts[today].W03.key, 1);
    });
  });
  await test("Core Native generation reuse across Main sessions counts new input once; old epoch cannot resurrect", async () => {
    const root = fixture("generation");
    const candidate = {
      type: "candidate",
      protocolVersion: 2,
      generation: 1,
      sequence: 1,
      transaction: 1,
      date: today,
      origin: "key",
      route: "win-up",
      injected: false,
      conflicted: false,
      evidence: {
        kind: "window",
        profile: "legacy-window-v1",
        result: {
          app: "chrome",
          operation: "maximize",
          before: { state: "normal", arranged: false },
          after: { state: "maximized" },
          moving: false,
          elevated: false,
          targetMatched: true,
          inputAgeMs: 100,
          monitor: null,
          afterArranged: null,
          fromMonitor: null,
          toMonitor: null,
          moveDirection: null,
        },
      },
    };
    for (let i = 1; i <= 2; i++)
      await using(root, async (repo) => {
        const coach = new DurableCoach({
          repository: repo,
          session: repo.session,
          date: () => today,
          now: () => 0,
          capabilities: () => [],
          notify: async () => false,
          changed: () => {},
        });
        await coach.initialize();
        assert.equal(coach.snapshot().error, null);
        coach.begin(1);
        await coach.accept(candidate);
        await coach.accept(candidate);
        assert.equal((await repo.load(today)).counts[today].W03.key, i);
        if (i === 2) {
          await coach.deleteCounts();
          await coach.accept({ ...candidate, sequence: 2, transaction: 2 });
          assert.deepEqual((await repo.load(today)).counts, {});
        }
      });
  });
  await test("bundled Core Worker death keeps pending/error and stops; retry clears pending without auto-resume", async () => {
    const root = fixture("core-pending");
    await using(root, async (repo) => {
      const coach = new DurableCoach({
        repository: repo,
        session: repo.session,
        date: () => today,
        now: () => 0,
        capabilities: () => [{ operation: "W03", revision: "v02-fixture" }],
        notify: async () => false,
        changed: () => {},
      });
      await coach.initialize();
      assert.equal(coach.snapshot().error, null);
      coach.begin(1);
      const active = Reflect.get(repo, "worker");
      active.postMessage = () => {
        void active.terminate();
      };
      await coach.accept({
        type: "candidate",
        protocolVersion: 2,
        generation: 1,
        sequence: 1,
        transaction: 1,
        date: today,
        origin: "key",
        route: "win-up",
        injected: false,
        conflicted: false,
        evidence: {
          kind: "window",
          profile: "legacy-window-v1",
          result: {
            app: "chrome",
            operation: "maximize",
            before: { state: "normal", arranged: false },
            after: { state: "maximized" },
            moving: false,
            elevated: false,
            targetMatched: true,
            inputAgeMs: 100,
            monitor: null,
            afterArranged: null,
            fromMonitor: null,
            toMonitor: null,
            moveDirection: null,
          },
        },
      });
      assert.equal(coach.snapshot().pendingSave, true);
      assert.equal(coach.snapshot().errorKind, "record-save");
      coach.begin(2);
      assert.equal(coach.snapshot().observing, false);
      await Promise.all([coach.retrySave(), coach.retrySave()]);
      assert.equal(coach.snapshot().pendingSave, false);
      assert.equal(coach.snapshot().error, null);
      assert.equal(coach.snapshot().observing, false);
      assert.equal((await repo.load(today)).counts[today].W03.key, 1);
    });
  });
  assert.ok(
    results.every((result) => result.passed),
    "V02 cases failed",
  );
  console.log("V02_SUITE_OK");
}
const operation = process.argv.includes("--child")
  ? childMain(process.argv[3], process.argv[4])
  : suite();
operation.catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
