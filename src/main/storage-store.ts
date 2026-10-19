import { DatabaseSync } from 'node:sqlite';
import { openSync, closeSync, readFileSync, writeFileSync, fsyncSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { operations, type OperationId, type Settings } from '../shared/coach.ts';
import type { Coverage, RecordMutation, RecordRange, StorageState } from '../shared/storage.ts';
import { daysBefore } from '../shared/storage.ts';
import { validDate } from '../core/dates.ts';
import type { LegacyImport } from './storage-migration.ts';
import { fileExists } from './storage-files.ts';

const ids = [...operations.map(op => op.id), 'W12', 'W13', 'W14'];
const check = (ok: unknown, message: string): void => { if (!ok) throw new Error(message); };
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
function validateSettings(settings: Settings): void {
  check(settings && typeof settings === 'object' && !Array.isArray(settings) && typeof settings.opened === 'boolean' &&
    Array.isArray(settings.muted) && settings.muted.every(id => ids.includes(id)) &&
    new Set(settings.muted).size === settings.muted.length && Object.keys(settings).every(k => ['muted', 'opened', 'states'].includes(k)), 'INVALID_SETTINGS');
  if (settings.states !== undefined) check(settings.states && typeof settings.states === 'object' && !Array.isArray(settings.states) &&
    Object.entries(settings.states).every(([id, state]) => ids.includes(id) && ['learning', 'mastered', 'excluded'].includes(state)), 'INVALID_STATES');
}
export class StorageStore {
  private db: DatabaseSync;
  private root: string;
  private mode: 'active' | 'staging';
  constructor(root: string, mode: 'active' | 'staging' = 'active') {
    this.root = root;
    this.mode = mode;
    const file = join(root, 'records.sqlite');
    const marker = join(root, 'authority.json');
    const existed = fileExists(file);
    const migrated = fileExists(join(root, 'source.json'));
    if (mode === 'active' && migrated) check(existed && fileExists(join(root, 'initialized')), 'MIGRATED_DATABASE_MISSING');
    const authority = { schemaVersion: 1, file: 'records.sqlite' };
    if (!fileExists(marker)) {
      check(!existed, 'UNKNOWN_DATABASE');
      const fd = openSync(marker + '.tmp', 'w');
      try { writeFileSync(fd, JSON.stringify(authority)); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(marker + '.tmp', marker);
    } else check(JSON.stringify(JSON.parse(readFileSync(marker, 'utf8'))) === JSON.stringify(authority), 'UNKNOWN_AUTHORITY');
    // A committed authority must never fall back to JSON or recreate a missing database.
    const initializing = join(root, 'initializing');
    if (!existed && fileExists(join(root, 'initialized'))) throw new Error('DATABASE_MISSING');
    if (!existed) writeFileSync(initializing, '1', { flag: 'a' });
    this.db = new DatabaseSync(file, { timeout: 1000 });
    try {
      check(this.db.prepare('PRAGMA quick_check').get()?.quick_check === 'ok', 'DATABASE_CORRUPT');
      const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
      if (version === 0) {
        check(fileExists(initializing) && !fileExists(join(root, 'initialized')), 'UNKNOWN_SCHEMA');
        check(this.db.prepare('SELECT COUNT(*) AS n FROM sqlite_schema').get()?.n === 0, 'UNKNOWN_SCHEMA');
        this.transaction(() => this.db.exec(`
          CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK(id=1), epoch INTEGER NOT NULL, highWater TEXT NOT NULL,
            revision INTEGER NOT NULL, session TEXT NOT NULL, sequence INTEGER NOT NULL, hash TEXT NOT NULL) STRICT;
          INSERT INTO meta VALUES (1,1,'',0,'',0,'');
          CREATE TABLE counts (day TEXT NOT NULL, operation TEXT NOT NULL, mouse INTEGER NOT NULL CHECK(mouse>=0),
            key INTEGER NOT NULL CHECK(key>=0), PRIMARY KEY(day,operation)) STRICT;
          CREATE TABLE coverage (day TEXT NOT NULL, operation TEXT NOT NULL, knowledge TEXT NOT NULL,
            activeMs INTEGER NOT NULL CHECK(activeMs>=0), gap INTEGER NOT NULL, capabilityRevision TEXT NOT NULL,
            PRIMARY KEY(day,operation)) STRICT;
          CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL) STRICT;
          INSERT INTO settings VALUES (1,'{"muted":[],"opened":false}');
          PRAGMA user_version=1;
        `));
      } else check(version === 1, 'UNSUPPORTED_SCHEMA');
      check(this.db.prepare('PRAGMA journal_mode=WAL').get()?.journal_mode === 'wal', 'WAL_UNAVAILABLE');
      this.db.exec('PRAGMA synchronous=FULL');
      check(this.db.prepare('PRAGMA synchronous').get()?.synchronous === 2, 'SYNC_UNAVAILABLE');
      if (mode === 'active' && !migrated && this.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='migration'").get()) {
        check(!this.db.prepare('SELECT id FROM migration WHERE id=1').get(), 'MIGRATION_SOURCE_MISSING');
      }
      if (mode === 'active' && migrated) {
        check(this.db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='table' AND name IN ('migration','legacy_days')").get()?.n === 2,
          'MIGRATION_SCHEMA_MISSING');
      } else {
        // Only an unmigrated schema or an unpublished stage may acquire these optional tables.
        this.db.exec('CREATE TABLE IF NOT EXISTS migration (id INTEGER PRIMARY KEY CHECK(id=1), identity TEXT NOT NULL, purge INTEGER NOT NULL) STRICT');
        this.db.exec('CREATE TABLE IF NOT EXISTS legacy_days (day TEXT PRIMARY KEY) STRICT');
      }
      if (mode === 'active' && migrated) {
        const source = JSON.parse(readFileSync(join(root, 'source.json'), 'utf8'));
        const migration = this.db.prepare('SELECT identity,purge FROM migration WHERE id=1').get();
        check(source.schemaVersion === 1 && Object.keys(source).sort().join(',') === 'identity,schemaVersion' &&
          typeof source.identity === 'string' && /^[a-f0-9]{64}$/.test(source.identity) && migration?.identity === source.identity &&
          [0,1,2].includes(Number(migration?.purge)), 'INVALID_MIGRATION_AUTHORITY');
      }
      if (mode === 'active') this.purgeLegacy();
      // Schema itself is the durable authority; this marker also detects a subsequently missing DB.
      const fd = openSync(join(root, 'initialized'), 'w');
      try { writeFileSync(fd, '1'); fsyncSync(fd); } finally { closeSync(fd); }
    } catch (error) { this.db.close(); throw error; }
  }
  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { try { this.db.exec('ROLLBACK'); } catch {} throw error; }
  }
  private meta() { return this.db.prepare('SELECT * FROM meta WHERE id=1').get()!; }
  importLegacy(source: LegacyImport): void {
    if (this.db.prepare('SELECT * FROM migration WHERE id=1').get()) { this.verifyLegacy(source); return; }
    check(this.meta().revision === 0 && this.db.prepare('SELECT COUNT(*) AS n FROM counts').get()?.n === 0, 'MIGRATION_NOT_EMPTY');
    this.transaction(() => {
      for (const day of Object.keys(source.counts)) this.db.prepare('INSERT INTO legacy_days VALUES (?)').run(day);
      for (const [day, values] of Object.entries(source.counts)) for (const [id, count] of Object.entries(values)) {
        this.db.prepare('INSERT INTO counts VALUES (?,?,?,?)').run(day, id, count!.mouse, count!.key);
        this.db.prepare('INSERT INTO coverage VALUES (?,?,?,?,?,?)').run(day, id, 'legacy-unknown', 0, 1, 'legacy-v1');
      }
      this.db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(this.legacySettings(source.settings)));
      this.db.prepare('INSERT INTO migration VALUES (1,?,0)').run(source.identity);
      const lastDay = Object.keys(source.counts).sort().at(-1) ?? '';
      this.db.prepare('UPDATE meta SET highWater=?,revision=1 WHERE id=1').run(lastDay);
      this.db.exec('PRAGMA user_version=1');
    });
  }
  private legacySettings(settings: Settings): Settings {
    return { ...settings, states: Object.fromEntries(ids.map(id => [id, settings.muted.includes(id as OperationId) ? 'excluded' : 'learning'])) };
  }
  verifyLegacy(source: LegacyImport): void {
    const migration = this.db.prepare('SELECT identity,purge FROM migration WHERE id=1').get();
    check(migration?.identity === source.identity && migration.purge === 0, 'MIGRATION_IDENTITY');
    check(JSON.stringify(this.db.prepare('SELECT day FROM legacy_days ORDER BY day').all().map(row => row.day)) ===
      JSON.stringify(Object.keys(source.counts).sort()), 'MIGRATION_DAYS');
    const expected = Object.entries(source.counts).flatMap(([day, values]) => Object.entries(values).map(([operation, count]) => ({ day, operation, mouse: count!.mouse, key: count!.key })))
      .sort((a,b) => a.day.localeCompare(b.day) || a.operation.localeCompare(b.operation));
    const actual = this.db.prepare('SELECT day,operation,mouse,key FROM counts ORDER BY day,operation').all();
    check(JSON.stringify(actual) === JSON.stringify(expected), 'MIGRATION_COUNTS');
    const coverage = this.db.prepare('SELECT * FROM coverage ORDER BY day,operation').all();
    check(coverage.length === expected.length && coverage.every((row, i) => row.day === expected[i].day && row.operation === expected[i].operation &&
      row.knowledge === 'legacy-unknown' && row.activeMs === 0 && row.gap === 1 && row.capabilityRevision === 'legacy-v1'), 'MIGRATION_COVERAGE');
    check(this.db.prepare('SELECT value FROM settings WHERE id=1').get()?.value === JSON.stringify(this.legacySettings(source.settings)), 'MIGRATION_SETTINGS');
    check(this.meta().revision === 1 && this.meta().epoch === 1 && this.meta().highWater === (Object.keys(source.counts).sort().at(-1) ?? ''), 'MIGRATION_META');
  }
  private purgeLegacy(): void {
    if (this.mode !== 'active') return;
    if (this.db.prepare('SELECT purge FROM migration WHERE id=1').get()?.purge !== 1) return;
    for (const name of ['counts.json', 'settings.json']) {
      try { unlinkSync(join(dirname(this.root), name)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    this.db.prepare('UPDATE migration SET purge=2 WHERE id=1').run();
  }
  load(today: string): StorageState {
    check(validDate(today), 'INVALID_DAY');
    const meta = this.meta();
    const settings: Settings = JSON.parse(String(this.db.prepare('SELECT value FROM settings WHERE id=1').get()!.value));
    validateSettings(settings);
    return { ...this.query(daysBefore(today, 59), today), settings,
      epoch: Number(meta.epoch), highWater: String(meta.highWater) };
  }
  query(from: string, to: string): RecordRange {
    check(validDate(from) && validDate(to) && from <= to && to <= daysBefore(from, -59), 'INVALID_RANGE');
    const result: RecordRange = { counts: {}, coverage: {}, revision: Number(this.meta().revision) };
    for (const row of this.db.prepare('SELECT day FROM legacy_days WHERE day>=? AND day<=? ORDER BY day').all(from, to)) result.counts[String(row.day)] = {};
    for (const row of this.db.prepare('SELECT * FROM counts WHERE day>=? AND day<=? ORDER BY day,operation').all(from, to)) {
      (result.counts[String(row.day)] ??= {})[row.operation as OperationId] = { mouse: Number(row.mouse), key: Number(row.key) };
    }
    for (const row of this.db.prepare('SELECT * FROM coverage WHERE day>=? AND day<=? ORDER BY day,operation').all(from, to)) {
      (result.coverage[String(row.day)] ??= {})[row.operation as OperationId] = { knowledge: row.knowledge as Coverage['knowledge'],
        activeMs: Number(row.activeMs), gap: Boolean(row.gap), capabilityRevision: String(row.capabilityRevision) };
    }
    return result;
  }
  commit(value: RecordMutation): void {
    check(validDate(value.today) && integer(value.epoch) && value.epoch > 0 && integer(value.sequence) && value.sequence > 0 &&
      typeof value.writeSession === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value.writeSession), 'INVALID_WRITE');
    check(Array.isArray(value.coverage) && value.coverage.length <= 14, 'INVALID_COVERAGE');
    for (const row of value.coverage) {
      check(validDate(row.day) && row.day <= value.today && ids.includes(row.operation) && integer(row.value.activeMs) &&
        ['observed', 'not-observed', 'legacy-unknown'].includes(row.value.knowledge) && typeof row.value.gap === 'boolean' &&
        typeof row.value.capabilityRevision === 'string' && row.value.capabilityRevision.length <= 80 &&
        (row.value.knowledge === 'observed' || row.value.activeMs === 0), 'INVALID_COVERAGE');
    }
    if (value.count) check(validDate(value.count.day) && value.count.day <= value.today && ids.includes(value.count.operation) &&
      ['mouse', 'key'].includes(value.count.origin), 'INVALID_COUNT');
    check(value.reset === undefined || value.reset === true, 'INVALID_RESET');
    const hash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
    this.transaction(() => {
      const meta = this.meta();
      // The last checkpoint alone is retained, including after reset, so lost reset ACKs are safe too.
      if (meta.session === value.writeSession && meta.sequence === value.sequence) {
        check(meta.hash === hash, 'WRITE_CONFLICT'); return;
      }
      check(meta.epoch === value.epoch, 'STALE_EPOCH');
      check(meta.session === '' || meta.session === value.writeSession, 'STALE_SESSION');
      check(value.sequence === Number(meta.sequence) + 1, 'WRITE_SEQUENCE');
      if (!value.reset) {
        check(String(meta.highWater) <= value.today, 'CLOCK_BACKWARD');
        const future = this.db.prepare('SELECT day FROM counts WHERE day>? LIMIT 1').get(value.today);
        check(!future, 'FUTURE_RECORDS');
      }
      if (value.reset) this.db.exec('DELETE FROM counts; DELETE FROM coverage; DELETE FROM legacy_days; UPDATE migration SET purge=1 WHERE id=1;');
      else {
        if (value.count) {
          const c = value.count;
          this.db.prepare(`INSERT INTO counts VALUES (?,?,?,?) ON CONFLICT(day,operation) DO UPDATE SET
            mouse=mouse+excluded.mouse,key=key+excluded.key`).run(c.day, c.operation, c.origin === 'mouse' ? 1 : 0, c.origin === 'key' ? 1 : 0);
          const saved = this.db.prepare('SELECT mouse,key FROM counts WHERE day=? AND operation=?').get(c.day, c.operation)!;
          check(integer(Number(saved.mouse)) && integer(Number(saved.key)), 'COUNTER_OVERFLOW');
        }
        for (const row of value.coverage) {
          const v = row.value;
          this.db.prepare(`INSERT INTO coverage VALUES (?,?,?,?,?,?) ON CONFLICT(day,operation) DO UPDATE SET
            knowledge=CASE WHEN coverage.knowledge='observed' OR excluded.knowledge='observed' THEN 'observed' ELSE excluded.knowledge END,
            activeMs=activeMs+excluded.activeMs,gap=gap OR excluded.gap OR capabilityRevision<>excluded.capabilityRevision,
            capabilityRevision=excluded.capabilityRevision`).run(row.day, row.operation, v.knowledge, v.activeMs, Number(v.gap), v.capabilityRevision);
          const saved = this.db.prepare('SELECT activeMs FROM coverage WHERE day=? AND operation=?').get(row.day, row.operation)!;
          check(integer(Number(saved.activeMs)), 'COVERAGE_OVERFLOW');
        }
      }
      this.db.prepare('UPDATE meta SET epoch=?,highWater=?,revision=revision+1,session=?,sequence=?,hash=? WHERE id=1')
        .run(value.reset ? value.epoch + 1 : value.epoch, value.today, value.writeSession, value.sequence, hash);
    });
    this.purgeLegacy();
  }
  claim(session: string): void {
    check(/^[a-zA-Z0-9-]{1,80}$/.test(session), 'INVALID_SESSION');
    this.transaction(() => this.db.prepare("UPDATE meta SET session=?,sequence=0,hash='' WHERE id=1").run(session));
  }
  saveSettings(settings: Settings): void {
    validateSettings(settings);
    this.transaction(() => {
      this.db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(settings));
      this.db.exec('UPDATE meta SET revision=revision+1 WHERE id=1');
    });
  }
  close(): void { this.db.close(); }
}
