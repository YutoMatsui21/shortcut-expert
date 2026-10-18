import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, access, chmod, copyFile } from 'node:fs/promises';
import { resolve, join, relative, normalize } from 'node:path';
import { release } from 'node:os';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import electron from 'electron';
import { extractFile } from '@electron/asar';

const packaged = process.argv.includes('--packaged');
const executable = packaged ? resolve('release/sqlite-probe/win-unpacked/SQLite Storage Probe.exe') : electron;
await access(executable); // Fail once, before creating fixtures, if packaging has not completed.
const base = resolve('.tools/validation');
await mkdir(base, { recursive: true });
const output = await mkdtemp(join(base, 'sqlite-'));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.ELECTRON_RENDERER_URL;
const sourceHashes = {};
for (const file of ['scripts/sqlite-probe.mjs', 'validation/probes/sqlite/main.cjs', 'validation/probes/sqlite/worker.cjs',
  'validation/probes/sqlite/store.cjs', 'validation/probes/sqlite/electron-builder.cjs']) {
  const bytes = await readFile(file);
  sourceHashes[file] = sha(bytes);
  if (packaged && file.startsWith('validation/')) {
    assert.equal(sha(extractFile(resolve('release/sqlite-probe/win-unpacked/resources/app.asar'), normalize(file))), sha(bytes), 'Repackage changed probe sources: ' + file);
  }
}
const evidence = { started: new Date().toISOString(), packaged, executable: relative(resolve('.'), executable),
  fixture: relative(resolve('.'), output), windows: release(), sourceHashes,
  ...(packaged ? { asarHash: sha(await readFile('release/sqlite-probe/win-unpacked/resources/app.asar')) } : {}), tests: [] };
async function fixture(name) {
  const root = join(output, name);
  await mkdir(root);
  await writeFile(join(root, '.sqlite-fixture'), 'T10 isolated fixture\n');
  return root;
}
async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function waitFile(file, child) {
  const deadline = Date.now() + 20_000;
  while (!await exists(file)) {
    if (child.exitCode !== null) throw new Error('Child exited before checkpoint: ' + file);
    if (Date.now() > deadline) throw new Error('Checkpoint timeout: ' + file);
    await delay(25);
  }
  return JSON.parse(await readFile(file, 'utf8'));
}
async function run(root, action, request = {}, options = {}) {
  await writeFile(join(root, 'request.json'), JSON.stringify(request));
  const args = [...(packaged ? [] : [resolve('validation/probes/sqlite')]), '--sqlite-fixture', root, action];
  // Development launch uses the same main file without an application directory manifest.
  if (!packaged) args[0] = resolve('validation/probes/sqlite/main.cjs');
  const start = performance.now();
  const child = spawn(executable, args, { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.resume();
  const completion = new Promise((done, fail) => {
    child.once('error', fail);
    child.once('exit', (code, signal) => done({ code, signal }));
  });
  // Crash-point waits can fail before we await completion (for example a spawn error).
  completion.catch(() => {});
  const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
  try {
    if (options.pause) {
      const phase = await waitFile(join(root, 'phase.json'), child);
      assert.equal(phase.phase, request.pause);
      if (options.atPause) await options.atPause(root, child);
      if (options.kill) { child.kill('SIGKILL'); await completion; return { killed: true, phase }; }
      await writeFile(join(root, 'release'), 'continue');
    }
    const exit = await completion;
    assert.equal(exit.code, 0, stderr);
    const result = JSON.parse(await readFile(join(root, 'result.json'), 'utf8'));
    assert.equal(result.runtime.packaged, packaged);
    if (packaged) assert.equal(result.workerOutsideAsar, true);
    evidence.runtime ??= result.runtime;
    if (!options.failure) assert.equal(result.ok, true, JSON.stringify(result));
    else assert.equal(result.ok, false, 'expected safe failure');
    return { ...result, elapsedMs: Math.round(performance.now() - start) };
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill('SIGKILL'); }
}
function batch(id, extra = {}) { return { generation: 1, id, day: '2026-10-18', operation: 'W03', mouse: 1, key: 0, ...extra }; }
async function test(name, action) {
  const start = performance.now();
  try {
    const detail = await action();
    evidence.tests.push({ name, ok: true, elapsedMs: Math.round(performance.now() - start), detail });
    console.log('PASS ' + name);
  } catch (error) {
    evidence.tests.push({ name, ok: false, error: error.stack });
    console.error('FAIL ' + name + '\n' + error.stack);
  }
  await writeFile(join(output, 'report.json'), JSON.stringify(evidence, null, 2));
}
const root = await fixture('durable');
await test('disk-write-restart-and-worker-order', async () => {
  const result = await run(root, 'write', { batches: Array.from({ length: 64 }, (_, i) => batch(`ordered-${i}`, { mouse: i, key: 1 })) });
  assert.equal(result.result.replies.length, 64);
  assert.deepEqual(result.result.rows, [{ day: '2026-10-18', operation: 'W03', mouse: 2016, key: 64 }]);
  const restart = await run(root, 'inspect');
  assert.deepEqual(restart.result.rows, result.result.rows);
  assert.equal(restart.result.integrity, 'ok');
  return { sqlite: result.result.sqlite, journal: result.result.journal, synchronous: result.result.synchronous, rows: restart.result.rows };
});
await test('duplicate-conflict-and-generation-fence', async () => {
  const duplicate = await run(root, 'write', { batches: [batch('ordered-0', { mouse: 0, key: 1 })] });
  assert.deepEqual(duplicate.result.replies, ['duplicate']);
  const conflict = await run(root, 'write', { batches: [batch('ordered-0')] }, { failure: true });
  assert.match(conflict.error, /WRITE_ID_CONFLICT/);
  const isolated = await fixture('generation');
  await run(isolated, 'write', { batches: [batch('before-reset')] });
  const reset = await run(isolated, 'reset');
  assert.equal(reset.result.generation, 2);
  const stale = await run(isolated, 'write', { batches: [batch('before-reset'), batch('late')] }, { failure: true });
  assert.match(stale.error, /STALE_GENERATION/);
  const current = await run(isolated, 'write', { batches: [batch('new', { generation: 2 })] });
  assert.equal(current.result.rows[0].mouse, 1);
  return { duplicate: true, conflictRejected: true, oldGenerationRejected: true };
});
for (const phase of ['before-commit', 'after-commit']) {
  await test('process-kill-' + phase, async () => {
    const isolated = await fixture('kill-' + phase);
    await run(isolated, 'write', { batches: [batch('baseline')] });
    await run(isolated, 'write', { batches: [batch('uncertain')], pause: phase }, {
      pause: true, kill: true,
      atPause: async (directory) => {
        const initial = await waitFile(join(directory, 'heartbeat.json'), { exitCode: null });
        await delay(150);
        const next = JSON.parse(await readFile(join(directory, 'heartbeat.json'), 'utf8'));
        assert.ok(next.ticks > initial.ticks, 'Main must remain responsive while Worker blocks');
      }
    });
    const restarted = await run(isolated, 'inspect');
    assert.equal(restarted.result.rows[0].mouse, phase === 'after-commit' ? 2 : 1);
    const retry = await run(isolated, 'write', { batches: [batch('uncertain')] });
    assert.equal(retry.result.rows[0].mouse, 2);
    assert.deepEqual(retry.result.replies, [phase === 'after-commit' ? 'duplicate' : 'written']);
    return { afterRestart: restarted.result.rows, afterRetry: retry.result.rows, integrity: retry.result.integrity };
  });
}
await test('sqlite-full-rollback-and-retry', async () => {
  const failure = await run(root, 'full');
  const retry = await run(root, 'write', { batches: [batch('after-full')] });
  assert.equal(retry.result.rows[0].mouse, 2017);
  return failure.result.failure;
});
await test('windows-readonly-file-rollback-and-retry', async () => {
  const file = join(root, 'records.sqlite');
  await chmod(file, 0o444);
  let result;
  try { result = await run(root, 'readonly', { batch: batch('after-permission') }, { failure: false }); }
  finally { await chmod(file, 0o666); }
  const retry = await run(root, 'write', { batches: [batch('after-permission')] });
  assert.equal(retry.result.rows[0].mouse, 2018);
  return result.result.failure;
});
await test('windows-ntfs-write-denial-and-retry', async () => {
  const isolated = await fixture('ntfs-permission');
  await run(isolated, 'write', { batches: [batch('baseline')] });
  const file = join(isolated, 'records.sqlite');
  const before = await readFile(file);
  const sid = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).match(/S-1-[0-9-]+/)?.[0];
  assert.ok(sid, 'current Windows user SID');
  const acl = (args) => execFileSync('icacls.exe', [file, ...args], { windowsHide: true, stdio: 'pipe' });
  let result;
  try {
    acl(['/deny', `*${sid}:(W)`]);
    result = await run(isolated, 'write', { batches: [batch('denied')] }, { failure: true });
    assert.ok([8, 14].includes(result.errcode & 255), JSON.stringify(result));
  } finally { acl(['/remove:d', `*${sid}`]); }
  assert.deepEqual(await readFile(file), before);
  const retry = await run(isolated, 'write', { batches: [batch('denied')] });
  assert.equal(retry.result.rows[0].mouse, 2);
  return { errcode: result.errcode, originalBytesPreserved: true, retryMouse: 2 };
});
await test('corrupt-db-preserved-and-future-version-rejected', async () => {
  const corrupt = await fixture('corrupt');
  await copyFile(join(root, 'records.sqlite'), join(corrupt, 'records.sqlite'));
  const file = join(corrupt, 'records.sqlite');
  const bytes = await readFile(file);
  bytes.fill(0xff, 0, 100);
  await writeFile(file, bytes);
  const bad = await run(corrupt, 'inspect', {}, { failure: true });
  assert.equal(bad.errcode & 255, 26);
  assert.equal(sha(await readFile(file)), sha(bytes));
  const damagedPage = await fixture('corrupt-page');
  const pageFile = join(damagedPage, 'records.sqlite');
  const pageBytes = await readFile(join(root, 'records.sqlite'));
  const pageSize = pageBytes.readUInt16BE(16);
  pageBytes[pageSize] = 0xff; // Break meta's first B-tree page, leaving the SQLite file header intact.
  await writeFile(pageFile, pageBytes);
  const pageFailure = await run(damagedPage, 'inspect', {}, { failure: true });
  assert.ok((pageFailure.errcode & 255) === 11 || /malformed|btree|page/i.test(pageFailure.error), 'integrity check must detect internal damage');
  assert.deepEqual(await readFile(pageFile), pageBytes);
  const future = await fixture('future');
  await run(future, 'future');
  const before = await readFile(join(future, 'records.sqlite'));
  const newer = await run(future, 'inspect', {}, { failure: true });
  assert.match(newer.error, /DB_VERSION_UNSUPPORTED/);
  assert.deepEqual(await readFile(join(future, 'records.sqlite')), before);
  return { corruptErrcode: bad.errcode, corruptPageError: pageFailure.error, corruptBytesPreserved: true, futureBytesPreserved: true };
});
await test('ten-years-retention-and-indexed-range', async () => {
  const isolated = await fixture('long-term');
  const batches = Array.from({ length: 3653 }, (_, i) => batch(`day-${i}`, {
    day: new Date(Date.UTC(2016, 0, 1 + i)).toISOString().slice(0, 10)
  }));
  const all = await run(isolated, 'write', { batches });
  assert.equal(all.result.rows.length, 3653);
  const selected = await run(isolated, 'inspect', { from: '2020-01-01', to: '2020-01-07' });
  assert.equal(selected.result.rows.length, 7);
  assert.equal(selected.result.rows[0].day, '2020-01-01');
  assert.equal(selected.result.rows[6].day, '2020-01-07');
  assert.match(selected.result.plan.map((r) => r.detail).join(' '), /SEARCH counts USING INDEX/);
  return { days: all.result.rows.length, rangeDays: 7, writeProcessMs: all.elapsedMs, readProcessMs: selected.elapsedMs, plan: selected.result.plan };
});
async function legacyFixture(name) {
  const directory = await fixture(name);
  const days = {};
  for (let i = 0; i < 400; i++) {
    const date = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
    days[date] = i === 0 ? {} : i === 1 ? Object.fromEntries(Array.from({ length: 11 }, (_, op) =>
      [`W${String(op + 1).padStart(2, '0')}`, { mouse: op, key: op + 1 }]))
      : { W03: { mouse: i, key: i + 1 }, W09: { mouse: 0, key: 0 } };
  }
  const bytes = [Buffer.from(JSON.stringify({ schemaVersion: 1, days }, null, 2) + '\r\n'),
    Buffer.from('{ "schemaVersion":1, "muted":["W03","W09"], "opened":true }\r\n')];
  await writeFile(join(directory, 'counts.json'), bytes[0]);
  await writeFile(join(directory, 'settings.json'), bytes[1]);
  return { directory, bytes };
}
async function unchanged(directory, bytes) {
  assert.deepEqual(await readFile(join(directory, 'counts.json')), bytes[0]);
  assert.deepEqual(await readFile(join(directory, 'settings.json')), bytes[1]);
}
await test('json-full-migration-byte-identity-and-repeat', async () => {
  const { directory, bytes } = await legacyFixture('migration');
  const first = await run(directory, 'migrate');
  assert.equal(first.result.days, 400);
  assert.equal(first.result.rows, 807);
  await unchanged(directory, bytes);
  const pointer = await readFile(join(directory, 'active.json'));
  const repeat = await run(directory, 'migrate');
  assert.deepEqual(repeat.result, first.result);
  assert.deepEqual(await readFile(join(directory, 'active.json')), pointer);
  await unchanged(directory, bytes);
  return first.result;
});
for (const phase of ['migration-before-commit', 'migration-before-switch', 'migration-after-switch']) {
  await test('migration-kill-restart-' + phase, async () => {
    const { directory, bytes } = await legacyFixture(phase);
    await run(directory, 'migrate', { pause: phase }, { pause: true, kill: true });
    assert.equal(await exists(join(directory, 'active.json')), phase === 'migration-after-switch');
    const resumed = await run(directory, 'migrate');
    assert.equal(resumed.result.rows, 807);
    await unchanged(directory, bytes);
    return { resumed: true, ...resumed.result };
  });
}
await test('migration-source-changed-before-switch', async () => {
  const { directory, bytes } = await legacyFixture('source-changed');
  const result = await run(directory, 'migrate', { pause: 'migration-before-switch' }, {
    pause: true, failure: true,
    atPause: (folder) => writeFile(join(folder, 'counts.json'), Buffer.concat([bytes[0], Buffer.from(' ')]))
  });
  assert.match(result.error, /SOURCE_CHANGED/);
  assert.equal(await exists(join(directory, 'active.json')), false);
  const before = await readFile(join(directory, 'migrated.sqlite'));
  const retry = await run(directory, 'migrate', {}, { failure: true });
  assert.match(retry.error, /Expected values to be strictly equal/);
  assert.deepEqual(await readFile(join(directory, 'migrated.sqlite')), before);
  return { refusedSwitch: true, retryRefusedMismatchedSource: true };
});
await test('migration-corrupt-future-invalid-stop-without-switch', async () => {
  const cases = [
    ['broken-json', '{'],
    ['future-json', JSON.stringify({ schemaVersion: 99, days: {} })],
    ['unknown-operation', JSON.stringify({ schemaVersion: 1, days: { '2026-01-01': { W99: { mouse: 1, key: 2 } } } })],
    ['invalid-date', JSON.stringify({ schemaVersion: 1, days: { '2026-02-30': {} } })],
    ['negative-count', JSON.stringify({ schemaVersion: 1, days: { '2026-01-01': { W03: { mouse: -1, key: 2 } } } })]
  ];
  for (const [name, content] of cases) {
    const { directory } = await legacyFixture(name);
    await writeFile(join(directory, 'counts.json'), content);
    const settingsBefore = await readFile(join(directory, 'settings.json'));
    await run(directory, 'migrate', {}, { failure: true });
    assert.equal(await exists(join(directory, 'active.json')), false);
    assert.equal(await exists(join(directory, 'migrated.sqlite')), false);
    assert.equal(await readFile(join(directory, 'counts.json'), 'utf8'), content);
    assert.deepEqual(await readFile(join(directory, 'settings.json')), settingsBefore);
  }
  for (const [name, content] of [
    ['future-settings', '{"schemaVersion":2,"muted":[],"opened":true}'],
    ['invalid-settings', '{"schemaVersion":1,"muted":["W99"],"opened":true}']
  ]) {
    const { directory, bytes } = await legacyFixture(name);
    await writeFile(join(directory, 'settings.json'), content);
    await run(directory, 'migrate', {}, { failure: true });
    assert.equal(await exists(join(directory, 'active.json')), false);
    assert.equal(await exists(join(directory, 'migrated.sqlite')), false);
    assert.deepEqual(await readFile(join(directory, 'counts.json')), bytes[0]);
    assert.equal(await readFile(join(directory, 'settings.json'), 'utf8'), content);
  }
  const { directory, bytes } = await legacyFixture('bad-destination');
  await writeFile(join(directory, 'migrated.sqlite'), 'broken destination');
  await run(directory, 'migrate', {}, { failure: true });
  assert.equal(await readFile(join(directory, 'migrated.sqlite'), 'utf8'), 'broken destination');
  assert.equal(await exists(join(directory, 'active.json')), false);
  await unchanged(directory, bytes);
  return { cases: [...cases.map(([name]) => name), 'future-settings', 'invalid-settings', 'corrupt-destination'], originalBytesPreserved: true };
});
evidence.finished = new Date().toISOString();
evidence.passed = evidence.tests.every((entry) => entry.ok);
await writeFile(join(output, 'report.json'), JSON.stringify(evidence, null, 2));
console.log('SQLITE_PROBE_REPORT ' + join(output, 'report.json'));
process.exit(evidence.passed ? 0 : 1);
