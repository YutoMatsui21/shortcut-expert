import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { classify } from '../src/core/detector.ts';
import { DurableCoach } from '../src/core/durable-coach.ts';
import { SqliteRepository } from '../src/main/sqlite-repository.ts';
import { taskbarFixture } from './support/fixtures.ts';
mock.module('electron', { namedExports: { app: {} } });
const { candidateV2 } = await import('../src/main/observer.ts');

test('W12 schema, numbers, strict meaning and unknown/negative evidence', () => {
  for (const origin of ['mouse', 'key'] as const) for (let slot = 1; slot <= 10; slot++) {
    const fixture = taskbarFixture(origin, 1, slot);
    assert.deepEqual(candidateV2(fixture), fixture);
    assert.equal(classify(fixture)?.operation, 'W12');
    assert.equal(classify(fixture)?.shortcut, `Win + ${slot === 10 ? 0 : slot}`);
    for (const extra of [{ injected: true }, { conflicted: true }, { origin: 'unknown' as const }, { route: 'alt-tab' }, { date: 'invalid' }])
      assert.equal(classify({ ...fixture, ...extra }), null);
    for (const extra of [{ slot: null }, { slot: 0 }, { slot: 11 }, { slot: 1.5 }, { mappingConfirmed: false },
      { snapshotAgeMs: 751 }, { snapshotAgeMs: -1 }, { snapshotAgeMs: NaN }, { confirmationAgeMs: 2501 }, { confirmationAgeMs: -1 }])
      assert.equal(classify({ ...fixture, evidence: { ...fixture.evidence, ...extra } }), null);
    for (const field of ['profile', 'slot', 'mappingConfirmed', 'snapshotAgeMs', 'confirmationAgeMs', 'monitor']) {
      const evidence: Record<string, unknown> = { ...fixture.evidence }; delete evidence[field];
      assert.equal(candidateV2({ ...fixture, evidence }), null, field);
    }
    for (const extra of [{ profile: 'unverified' }, { slot: 11 }, { slot: '1' }, { mappingConfirmed: 'true' }, { snapshotAgeMs: Infinity }, { monitor: {} }])
      assert.equal(candidateV2({ ...fixture, evidence: { ...fixture.evidence, ...extra } }), null);
    assert.deepEqual(candidateV2({ ...fixture, appId: 'private', evidence: { ...fixture.evidence, appId: 'private' } }), fixture);
  }
});

test('W12 real SQLite: both origins, three states, save-before-notify, replay, pause/stop and failure recovery', async t => {
  const root = await mkdtemp(join(tmpdir(), 'taskbar-input-'));
  const repository = new SqliteRepository(root, resolve('src/main/storage-worker.ts'));
  t.after(async () => { await repository.close(); await rm(root, { force: true, recursive: true }); });
  const notices: string[] = [];
  const coach = new DurableCoach({ repository, session: repository.session, date: () => '2026-10-21', now: () => 0,
    capabilities: () => [], changed: () => {}, notify: async value => {
      assert.ok((await repository.query('2026-10-21', '2026-10-21')).counts['2026-10-21'].W12?.mouse);
      notices.push(value.shortcut); return true;
    } });
  await coach.initialize(); coach.begin(1);
  let seq = 0;
  for (const state of ['learning', 'mastered', 'excluded'] as const) {
    await coach.setLearningState('W12', state);
    for (const origin of ['mouse', 'key'] as const) {
      const fixture = taskbarFixture(origin, ++seq);
      await coach.accept(fixture); await coach.accept(fixture);
      await coach.accept({ ...fixture, sequence: ++seq }); // a new delivery for same transaction
    }
  }
  assert.deepEqual(notices, ['Win + 0']);
  assert.deepEqual(coach.snapshot().counts['2026-10-21'].W12, { mouse: 3, key: 3 });
  assert.equal(coach.snapshot().counts['2026-10-21'].W01, undefined);
  await coach.setLearningState('W12', 'learning'); coach.pauseNotifications(true);
  await coach.accept(taskbarFixture('mouse', ++seq));
  coach.stop(); await coach.accept(taskbarFixture('mouse', ++seq));
  coach.begin(2); coach.pauseNotifications(false);
  const commit = repository.commit.bind(repository); let fail = true;
  repository.commit = async value => { if (fail && value.count) throw new Error('fixture-write-failure'); return commit(value); };
  await coach.accept({ ...taskbarFixture('mouse', 1), generation: 2 });
  assert.equal(coach.snapshot().pendingSave, true); assert.equal(notices.length, 1);
  fail = false; await coach.retrySave();
  assert.equal(coach.snapshot().pendingSave, false); assert.equal(notices.length, 1, 'retry does not resurrect notification');
  coach.begin(3); await coach.accept({ ...taskbarFixture('key', 1), generation: 3 });
  const records = await repository.query('2026-10-21', '2026-10-21');
  assert.deepEqual(records.counts['2026-10-21'].W12, { mouse: 5, key: 4 });
  const learning = await coach.getLearning('2026-10-21');
  assert.ok(JSON.stringify(learning).includes('W12'));
  assert.equal(coach.snapshot().coverage?.['2026-10-21'].W12?.knowledge, 'not-observed');
});
