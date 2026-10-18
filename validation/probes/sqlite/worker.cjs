const { parentPort, workerData, isMainThread } = require('node:worker_threads');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { connect, range, write, reset, migrate, transaction } = require('./store.cjs');

assert.equal(isMainThread, false);
const { root, action } = workerData;
const file = join(root, 'records.sqlite');
const requestFile = join(root, 'request.json');
const request = existsSync(requestFile) ? JSON.parse(readFileSync(requestFile, 'utf8')) : {};
function pause(phase) {
  writeFileSync(join(root, 'phase.json'), JSON.stringify({ phase }));
  // Deterministic crash point. The supervising script kills the entire Electron process.
  const signal = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(join(root, 'release'))) Atomics.wait(signal, 0, 0, 20);
}
function info(db) {
  return { sqlite: db.prepare('SELECT sqlite_version() AS version').get().version,
    journal: db.prepare('PRAGMA journal_mode').get().journal_mode,
    synchronous: db.prepare('PRAGMA synchronous').get().synchronous,
    integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
    generation: Number(db.prepare("SELECT value FROM meta WHERE name='generation'").get().value),
    rows: range(db, request.from ?? '0000-01-01', request.to ?? '9999-12-31'),
    writes: db.prepare('SELECT COUNT(*) AS n FROM writes').get().n,
    plan: db.prepare('EXPLAIN QUERY PLAN SELECT * FROM counts WHERE day>=? AND day<=?').all('2026-01-01', '2026-01-07') };
}
function execute() {
  if (action === 'migrate') return migrate(root, (phase) => { if (phase === request.pause) pause(phase); });
  if (action === 'future') {
    const db = connect(file, { create: true });
    db.exec('PRAGMA user_version=99'); db.close(); return { prepared: true };
  }
  const db = connect(file, { create: action === 'write' || action === 'initialize' });
  try {
    if (action === 'write') {
      const replies = [];
      for (const batch of request.batches) replies.push(write(db, batch, (phase) => {
        if (request.pause === phase) pause(phase);
      }));
      if (request.pause === 'after-commit') pause('after-commit');
      return { replies, ...info(db) };
    }
    if (action === 'reset') reset(db);
    if (action === 'full') {
      const before = info(db);
      const pages = db.prepare('PRAGMA page_count').get().page_count;
      db.exec(`PRAGMA max_page_count=${pages}`);
      let failure;
      try {
        transaction(db, () => {
          db.prepare('INSERT INTO writes VALUES (?,?,?)').run(1, 'failed-full', 'fixture');
          db.exec("UPDATE counts SET mouse=mouse+100");
          db.prepare('INSERT INTO capacity_fixture VALUES (?)').run(Buffer.alloc(1024 * 1024));
        });
      } catch (error) { failure = { message: error.message, errcode: error.errcode }; }
      assert.equal(failure?.errcode, 13, 'must hit real SQLite SQLITE_FULL');
      assert.deepEqual(info(db).rows, before.rows);
      assert.equal(info(db).writes, before.writes);
      db.exec('PRAGMA max_page_count=1073741823');
      return { failure, ...info(db) };
    }
    if (action === 'readonly') {
      // File's Windows read-only attribute was set by the supervisor, not an injected exception.
      let failure;
      try { write(db, request.batch); }
      catch (error) { failure = { message: error.message, errcode: error.errcode }; }
      assert.ok(failure && (failure.errcode & 255) === 8, 'must hit real SQLite SQLITE_READONLY');
      return { failure, ...info(db) };
    }
    return info(db);
  } finally { db.close(); }
}
try { parentPort.postMessage({ ok: true, result: execute() }); }
catch (error) { parentPort.postMessage({ ok: false, error: error.message, errcode: error.errcode, stack: error.stack }); }
