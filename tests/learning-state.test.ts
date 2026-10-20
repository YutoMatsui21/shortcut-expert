import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DurableCoach } from '../src/core/durable-coach.ts';
import { SqliteRepository } from '../src/main/sqlite-repository.ts';
import { learningState } from '../src/shared/learning.ts';
import type { Notice } from '../src/shared/coach.ts';
import { candidateFixture, deferred } from './support/fixtures.ts';

test('three states: real worker persistence, restart, unchanged history and notification eligibility', async t => {
  const root = await mkdtemp(join(tmpdir(), 'coach-learning-'));
  let repository = new SqliteRepository(root, resolve('src/main/storage-worker.ts'));
  t.after(async () => { await repository.close(); await rm(root, { recursive: true, force: true }); });
  // Exercise the production legacy migration, including muted -> excluded.
  await writeFile(join(root, 'settings.json'), JSON.stringify({ schemaVersion: 1, opened: true, muted: ['W03'] }));
  await writeFile(join(root, 'counts.json'), JSON.stringify({ schemaVersion: 1, days: { '2026-10-18': { W03: { mouse: 4, key: 2 } } } }));
  const notices: Notice[] = [];
  const makeCoach = () => new DurableCoach({ repository, session: repository.session, date: () => '2026-10-19',
    now: () => 0, capabilities: () => [], changed: () => {}, notify: async notice => { notices.push(notice); return true; } });
  let coach = makeCoach(); await coach.initialize(); coach.begin(1);
  assert.equal(learningState(coach.snapshot().settings, 'W03'), 'excluded');
  const sample = candidateFixture({ date: '2026-10-19' });
  let sequence = 0, generation = 1;
  const mouse = () => coach.accept({ ...sample, generation, sequence: ++sequence });
  const key = () => coach.accept({ ...sample, generation, sequence: ++sequence, origin: 'key', route: 'win-up' });
  await mouse(); assert.equal(notices.length, 0, 'migrated excluded still records');
  const countsBefore = structuredClone(coach.snapshot().counts);
  for (const state of ['learning', 'mastered', 'excluded'] as const) {
    await coach.setLearningState('W03', state);
    const snapshot = coach.snapshot(), model = await coach.getLearning('2026-10-19');
    assert.equal(model.revision, snapshot.revision);
    assert.equal(model.rows.find(row => row.id === 'W03')?.state, state);
    const before: number = notices.length;
    await mouse(); await mouse(); await key();
    assert.equal(notices.length - before, state === 'learning' ? 2 : 0, 'consecutive requests have no cooldown');
    coach.pauseNotifications(true); await mouse(); await key(); coach.pauseNotifications(false);
    assert.equal(notices.length - before, state === 'learning' ? 2 : 0, 'pause only disables notices');
    coach.stop(); const stoppedCounts = coach.snapshot().counts;
    await mouse(); await key(); assert.deepEqual(coach.snapshot().counts, stoppedCounts);
    assert.equal(notices.length - before, state === 'learning' ? 2 : 0, 'stop disables all notices');
    coach.begin(++generation);
  }
  assert.deepEqual(coach.snapshot().counts['2026-10-18'], countsBefore['2026-10-18']);
  assert.deepEqual(coach.snapshot().counts['2026-10-19'].W03, { mouse: 10, key: 6 });
  coach.stop(); const stopped = coach.snapshot().counts; await mouse(); await key(); assert.deepEqual(coach.snapshot().counts, stopped);
  await coach.setLearningState('W12', 'mastered'); await coach.setLearningState('W13', 'excluded');
  await repository.close(); repository = new SqliteRepository(root, resolve('src/main/storage-worker.ts'));
  coach = makeCoach(); await coach.initialize();
  assert.equal(learningState(coach.snapshot().settings, 'W12'), 'mastered');
  assert.equal(learningState(coach.snapshot().settings, 'W13'), 'excluded');
  assert.equal(learningState(coach.snapshot().settings, 'W01'), 'learning');
  assert.deepEqual(coach.snapshot().counts, stopped);
});

test('settings failure keeps confirmed state; retry keeps latest choices and counts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'coach-learning-fault-'));
  const repository = new SqliteRepository(root, resolve('src/main/storage-worker.ts'));
  t.after(async () => { await repository.close(); await rm(root, { recursive: true, force: true }); });
  const coach = new DurableCoach({ repository, session: repository.session, date: () => '2026-10-19', now: () => 0,
    capabilities: () => [], changed: () => {}, notify: async () => true });
  await coach.initialize(); coach.begin(1);
  const save = repository.saveSettings.bind(repository);
  repository.saveSettings = async () => { throw new Error('fixture disk full'); };
  await coach.setLearningState('W03', 'mastered');
  assert.equal(learningState(coach.snapshot().settings, 'W03'), 'learning');
  assert.equal((await coach.getLearning('2026-10-19')).rows.find(row => row.id === 'W03')?.state, 'learning');
  assert.equal(coach.snapshot().pendingSave, true); assert.equal(coach.snapshot().observing, false);
  await coach.setLearningState('W03', 'excluded'); await coach.setLearningState('W12', 'mastered');
  repository.saveSettings = save; await coach.retrySave();
  assert.equal(coach.snapshot().error, null); assert.equal(coach.snapshot().pendingSave, false);
  assert.equal(learningState(coach.snapshot().settings, 'W03'), 'excluded');
  assert.equal(learningState(coach.snapshot().settings, 'W12'), 'mastered');
  assert.deepEqual(coach.snapshot().counts, {});
  await coach.setMuted('W12', false); assert.equal(learningState(coach.snapshot().settings, 'W12'), 'learning');
  const query = repository.query.bind(repository), confirmedRevision = coach.snapshot().revision;
  repository.query = async () => { throw new Error('fixture post-save read failure'); };
  await coach.setLearningState('W03', 'mastered');
  assert.equal(learningState(coach.snapshot().settings, 'W03'), 'excluded');
  const confirmed = await coach.getLearning('2026-10-19');
  assert.equal(confirmed.revision, confirmedRevision);
  assert.equal(confirmed.rows.find(row => row.id === 'W03')?.state, 'excluded');
  assert.equal(coach.snapshot().pendingSave, true);
  repository.query = query; await coach.retrySave();
  assert.equal(learningState(coach.snapshot().settings, 'W03'), 'mastered');
  assert.equal(coach.snapshot().pendingSave, false);
});

for (const action of ['delay', 'pause', 'stop', 'stop-restart', 'failure', 'delivery-unknown'] as const) {
  test(`notification after persistence: ${action}`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'coach-learning-delivery-'));
    const repository = new SqliteRepository(root, resolve('src/main/storage-worker.ts'));
    t.after(async () => { await repository.close(); await rm(root, { recursive: true, force: true }); });
    let now = 0, requests = 0;
    const coach = new DurableCoach({ repository, session: repository.session, date: () => '2026-10-19', now: () => now,
      capabilities: () => [], changed: () => {}, notify: async () => { requests++; if (action === 'delivery-unknown') throw new Error('unknown'); return true; } });
    await coach.initialize(); coach.begin(1);
    const commit = repository.commit.bind(repository), entered = deferred<void>(), release = deferred<void>();
    repository.commit = async value => { entered.resolve(); await release.promise; if (action === 'failure') throw new Error('disk'); await commit(value); };
    const pending = coach.accept(candidateFixture({ date: '2026-10-19' }));
    await entered.promise; assert.equal(requests, 0);
    now = 5000;
    if (action === 'pause') coach.pauseNotifications(true);
    if (action === 'stop') coach.stop();
    if (action === 'stop-restart') {
      coach.pauseNotifications(true); coach.stop();
      coach.pauseNotifications(false);
      assert.equal(coach.snapshot().notificationsPaused, true, 'stopped commands cannot change the desired pause');
      coach.begin(2);
      assert.equal(coach.snapshot().observing, false, 'an in-flight save blocks restart');
    }
    release.resolve(); await pending;
    assert.equal(requests, action === 'delay' || action === 'delivery-unknown' ? 1 : 0);
    repository.commit = commit; await coach.retrySave();
    assert.equal(coach.snapshot().counts['2026-10-19'].W03?.mouse, 1);
    assert.equal(requests, action === 'delay' || action === 'delivery-unknown' ? 1 : 0, 'retry never replays a notice');
    if (action === 'stop-restart') {
      coach.begin(2); coach.pauseNotifications(false);
      await coach.accept(candidateFixture({ date: '2026-10-19', generation: 1, sequence: 2 }));
      assert.equal(coach.snapshot().counts['2026-10-19'].W03?.mouse, 1, 'old generation stays rejected after restart');
      await coach.accept(candidateFixture({ date: '2026-10-19', generation: 2, sequence: 1 }));
      assert.equal(coach.snapshot().counts['2026-10-19'].W03?.mouse, 2);
      assert.equal(requests, 1, 'only the new generation can request a notice');
    }
  });
}
