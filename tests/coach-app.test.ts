import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import type { registerCoachIpc } from '../src/main/coach-ipc.ts';
import type { ObserverCandidate, Snapshot } from '../src/shared/coach.ts';
import { candidateFixture } from './support/fixtures.ts';
import { localDate } from '../src/core/dates.ts';
import { SqliteRepository } from '../src/main/sqlite-repository.ts';
import { startupMode } from '../src/main/startup-mode.ts';

test('normal composition migrates without pruning, records via SQLite IPC, recovers stopped and closes the writer', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'coach-composition-'));
  const source = ' {"schemaVersion":1,"days":{"2020-01-02":{"W03":{"mouse":7,"key":5}}}}\n';
  await writeFile(path.join(root, 'counts.json'), source);
  // Only OS/UI boundaries are fake. Composition, Core, selection and Worker are real.
  Object.assign(globalThis, { __dirname: path.resolve('src/main') });
  mock.module('node:path', { namedExports: { ...path, join: (...parts: string[]) =>
    parts.at(-1) === 'storage-worker.cjs' ? path.resolve('src/main/storage-worker.ts') : path.join(...parts) } });
  let api!: Required<Parameters<typeof registerCoachIpc>[2]>;
  let deliver!: (candidate: ObserverCandidate) => void;
  let generation = 0, quits = 0, notices = 0;
  const app = Object.assign(new EventEmitter(), { getPath: () => root, quit: () => { quits++; app.emit('will-quit'); } });
  const window = {};
  mock.module('electron', { namedExports: { app, dialog: { showMessageBox: () => assert.fail('unexpected dialog') },
    Menu: { buildFromTemplate: (value: unknown) => value }, nativeImage: { createFromBitmap: () => ({}) },
    screen: new EventEmitter(), powerMonitor: new EventEmitter(), Tray: class {
      on() {} setToolTip() {} setContextMenu() {} destroy() {}
    } } });
  mock.module('../src/main/coach-window.ts', { namedExports: { CoachWindow: class {
    current = window;
    show() {} publish() {} command() {} resumeBounds() {} correctBounds() {}
    withWindowState(value: Snapshot) { return value; }
    async flush() {} async create() { return window; }
  } } });
  mock.module('../src/main/coach-ipc.ts', { namedExports: { registerCoachIpc: (_window: unknown, _notice: unknown, requests: typeof api) => { api = requests; } } });
  mock.module('../src/main/observer.ts', { namedExports: { ObserverClient: class {
    constructor(candidate: typeof deliver, _fault: unknown, fixture: boolean) { assert.equal(fixture, false); deliver = candidate; }
    async start() { return ++generation; } async stop() {} async shutdown() {}
  } } });
  mock.module('../src/main/notification.ts', { namedExports: { NotificationWindow: class {
    dismiss() {} sender() { return false; } current() { return null; }
    show() { assert.fail('normal composition must not use legacy notifications'); }
  } } });
  mock.module('../src/main/standard-notification.ts', { namedExports: { StandardNotifications: class {
    async show() { notices++; return true; } dispose() {}
  } } });
  mock.module('../src/main/validation-runtime.ts', { namedExports: { ValidationRuntime: class {
    constructor() { assert.fail('normal startup must not load fixtures'); }
  } } });
  mock.module('../src/core/coach.ts', { namedExports: { Coach: class {
    constructor() { assert.fail('normal startup must not construct legacy Coach'); }
  } } });
  const { runCoach } = await import('../src/main/coach-app.ts');
  t.after(async () => {
    if (api && !quits) await api.command('quit');
    await rm(root, { recursive: true, force: true });
    Reflect.deleteProperty(globalThis, '__dirname');
  });
  await runCoach(async () => {}, startupMode([]));
  assert.equal((await api.getSnapshot()).observing, true);
  assert.deepEqual((await api.getRecords('2020-01-02', '2020-01-02')).counts['2020-01-02'], { W03: { mouse: 7, key: 5 } });
  deliver(candidateFixture({ date: localDate(), origin: 'mouse', generation }));
  assert.equal((await api.getSnapshot()).counts[localDate()]?.W03?.mouse, 1);
  assert.equal(notices, 1, 'one committed operation requests one standard notification');
  assert.ok((await api.getLearning()).revision > 0);
  assert.ok((await api.getRecordSummary()).revision > 0);
  await api.command('stop');
  const query = mock.method(SqliteRepository.prototype, 'query', async () => { throw new Error('fixture unreadable'); });
  await assert.rejects(api.getRecords(localDate(), localDate()));
  assert.equal((await api.getSnapshot()).canRetrySave, true);
  query.mock.restore();
  const recovered = await api.command('retry-save');
  assert.equal(recovered.error, null); assert.equal(recovered.observing, false);
  await api.command('start');
  assert.equal((await api.getSnapshot()).observing, true);
  await api.command('quit'); assert.equal(quits, 1);
  const reopened = new SqliteRepository(root, path.resolve('src/main/storage-worker.ts'));
  try {
    await reopened.load(localDate());
    assert.equal((await reopened.query(localDate(), localDate())).counts[localDate()]?.W03?.mouse, 1);
    assert.equal((await reopened.query('2020-01-02', '2020-01-02')).counts['2020-01-02']?.W03?.mouse, 7);
    assert.equal(await readFile(path.join(root, 'counts.json'), 'utf8'), source, 'legacy source stays byte-identical');
  } finally { await reopened.close(); }
});
