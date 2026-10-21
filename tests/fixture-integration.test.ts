import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DurableCoach } from '../src/core/durable-coach.ts';
import { SqliteRepository } from '../src/main/sqlite-repository.ts';
import type { Candidate, OperationId } from '../src/shared/coach.ts';
import { candidateFixture, v2Fixture } from './support/fixtures.ts';

// Only Electron/OS boundaries are fake. Parse, classification, writer and models are real.
mock.module('electron', { namedExports: { app: {}, Notification: class {} } });
const { candidateV2 } = await import('../src/main/observer.ts');
const { StandardNotifications } = await import('../src/main/standard-notification.ts');
const today = '2026-10-21';
const cases: { id: OperationId; mouse: Partial<Candidate>; key: string; shortcut: string }[] = [
  { id: 'W03', mouse: {}, key: 'win-up', shortcut: 'Win + ↑' },
  { id: 'W04', mouse: { operation: 'minimize', after: { state: 'minimized' }, route: 'min-button' }, key: 'win-down', shortcut: 'Win + ↓' },
  { id: 'W05', mouse: { operation: 'restore', before: { state: 'maximized', arranged: false }, after: { state: 'normal' }, afterArranged: false }, key: 'win-down', shortcut: 'Win + ↓' },
  { id: 'W11', mouse: { operation: 'close', after: { state: 'closed' }, route: 'close-button' }, key: 'alt-f4', shortcut: 'Alt + F4' },
  { id: 'W02', mouse: { operation: 'monitor-move', after: { state: 'normal' }, route: 'caption-drag',
    fromMonitor: { x: 0, y: 0, width: 1920, height: 1080 }, toMonitor: { x: 1920, y: 0, width: 1920, height: 1080 }, moveDirection: 'right' }, key: 'win-shift-right', shortcut: 'Win + Shift + →' }
];

for (const entry of cases) test(`${entry.id}: strict v2 -> three states -> SQLite worker -> page models -> notification adapter`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'coach-integration-'));
  const repository = new SqliteRepository(root, resolve('src/main/storage-worker.ts'));
  const requests: Electron.NotificationConstructorOptions[] = [];
  const adapter = new StandardNotifications(() => {}, () => {}, options => {
    requests.push(options);
    return Object.assign(new EventEmitter(), { show() {} });
  });
  t.after(async () => { adapter.dispose(); await repository.close(); await rm(root, { recursive: true, force: true }); });
  const deliveries: Promise<boolean>[] = [];
  const coach = new DurableCoach({ repository, session: repository.session, date: () => today, now: () => 0,
    capabilities: () => [{ operation: entry.id, revision: 'synthetic-legacy-v1' }], changed: () => {},
    notify: notice => {
      const delivery = repository.query(today, today).then(saved => {
        assert.equal(saved.counts[today][entry.id]?.mouse, 1, 'the record is committed before adapter delivery');
        return adapter.show(notice);
      });
      deliveries.push(delivery); return delivery;
    } });
  await coach.initialize(); assert.equal(coach.snapshot().error, null); coach.begin(1);
  let sequence = 0;
  for (const state of ['learning', 'mastered', 'excluded'] as const) {
    await coach.setLearningState(entry.id, state);
    for (const origin of ['mouse', 'key'] as const) {
      const fixture = v2Fixture(candidateFixture({ ...entry.mouse, date: today, sequence: ++sequence,
        origin, ...(origin === 'key' ? { route: entry.key } : {}) }));
      // JSON round trip emulates the transport, without bypassing the Main schema.
      const parsed = candidateV2(JSON.parse(JSON.stringify(fixture)));
      assert.ok(parsed);
      await coach.accept(parsed); await coach.accept(parsed);
    }
    const expected = state === 'learning' ? 1 : state === 'mastered' ? 2 : 3;
    const counts = { mouse: expected, key: expected };
    assert.deepEqual((await repository.query(today, today)).counts[today][entry.id], counts);
    const learning = (await coach.getLearning(today)).rows.find(row => row.id === entry.id)!;
    assert.equal(learning.state, state); assert.equal(learning.mouse, expected); assert.equal(learning.key, expected);
    for (const filter of ['learning-mastered', 'learning', 'all'] as const) {
      const model = await coach.getRecordSummary(today, { period: 7, filter, sort: 'rate' });
      const row = model.rows.find(row => row.id === entry.id);
      const included = filter === 'all' || state === 'learning' || (filter === 'learning-mastered' && state === 'mastered');
      assert.equal(!!row, included, `${state}/${filter}`);
      if (row) { assert.equal(row.mouse, expected); assert.equal(row.key, expected); assert.equal(row.rate, 50); }
    }
  }
  await Promise.all(deliveries);
  assert.equal(requests.length, 1, 'mastered/excluded and replay do not notify');
  assert.equal(requests[0].title, entry.shortcut); assert.equal(requests[0].silent, true);
  coach.stop(); await coach.idle(); await repository.close();
  const reopened = new SqliteRepository(root, resolve('src/main/storage-worker.ts'));
  try {
    const saved = await reopened.load(today);
    assert.deepEqual(saved.counts[today][entry.id], { mouse: 3, key: 3 });
    assert.equal(saved.settings.states?.[entry.id], 'excluded');
  } finally { await reopened.close(); }
});
