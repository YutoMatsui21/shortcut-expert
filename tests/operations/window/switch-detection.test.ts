import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/core/detector.ts';
import { switchFixture } from './support/fixtures.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DurableCoach } from '../src/core/durable-coach.ts';
import { SqliteRepository } from '../src/main/sqlite-repository.ts';
mock.module('electron', { namedExports: { app: {} } });
const { candidateV2 } = await import('../src/main/observer.ts');

test('W01 requires matched input, different eligible windows and current foreground; only Alt+Tab guidance', () => {
  for (const origin of ['mouse', 'key'] as const) {
    const value = switchFixture(origin);
    assert.deepEqual(candidateV2(value), value);
    assert.deepEqual(classify(value), { id: '1:t1', operation: 'W01', origin, date: value.date, shortcut: 'Alt + Tab', monitor: value.evidence.monitor });
    for (const extra of [{ injected: true }, { conflicted: true }, { origin: 'unknown' as const }, { route: 'taskbar-click' }, { route: 'win-digit' }, { date: 'invalid' }])
      assert.equal(classify({ ...value, ...extra }), null);
    for (const extra of [{ windowsDifferent: false }, { eligible: false }, { inputTargetMatched: false }, { foregroundMatched: false },
      { inputAgeMs: -1 }, { inputAgeMs: 0 }, { inputAgeMs: NaN }, { inputAgeMs: origin === 'mouse' ? 1501 : 15001 },
      { settleMs: -1 }, { settleMs: Infinity }, { settleMs: origin === 'mouse' ? 1501 : 2001 }, ...(origin === 'key' ? [{ settleMs: 249 }] : [])])
      assert.equal(classify({ ...value, evidence: { ...value.evidence, ...extra } }), null);
    for (const field of Object.keys(value.evidence)) {
      const evidence: Record<string, unknown> = { ...value.evidence }; delete evidence[field];
      assert.equal(candidateV2({ ...value, evidence }), null, field);
    }
    for (const extra of [{ profile: 'unverified' }, { eligible: null }, { inputAgeMs: '500' }, { monitor: {} }])
      assert.equal(candidateV2({ ...value, evidence: { ...value.evidence, ...extra } }), null);
    assert.deepEqual(candidateV2({ ...value, hwnd: 123, evidence: { ...value.evidence, title: 'private', hwnd: 123 } }), value);
  }
});

test('W01 SQLite: replay, pause/stop, generation, save failure and retry do not resurrect notifications', async t => {
  const root = await mkdtemp(join(tmpdir(), 'window-switch-'));
  const repository = new SqliteRepository(root, resolve('src/main/storage-worker.ts'));
  t.after(async () => { await repository.close(); await rm(root, { force: true, recursive: true }); });
  const notices: string[] = [];
  const coach = new DurableCoach({ repository, session: repository.session, date: () => '2026-10-21', now: () => 0,
    capabilities: () => [], changed: () => {}, notify: async value => { notices.push(value.shortcut); return true; } });
  await coach.initialize(); coach.begin(1);
  const sample = switchFixture(); const parsed = candidateV2(sample); assert.ok(parsed);
  await coach.accept(parsed); await coach.accept(parsed); await coach.accept({ ...parsed, sequence: 2 });
  assert.deepEqual(notices, ['Alt + Tab']);
  coach.pauseNotifications(true); await coach.accept(switchFixture('mouse', 3));
  coach.stop(); await coach.accept(switchFixture('mouse', 4));
  coach.begin(2); await coach.accept(switchFixture('mouse', 5)); // obsolete generation
  const commit = repository.commit.bind(repository); let fail = true;
  repository.commit = async value => { if (fail && value.count) throw new Error('fixture-write-failure'); return commit(value); };
  await coach.accept({ ...switchFixture('mouse', 1), generation: 2 });
  assert.equal(coach.snapshot().pendingSave, true); assert.equal(notices.length, 1);
  fail = false; await coach.retrySave();
  assert.equal(coach.snapshot().pendingSave, false); assert.equal(notices.length, 1);
  coach.begin(3); await coach.accept({ ...switchFixture('key', 1), generation: 3 });
  assert.deepEqual((await repository.query('2026-10-21', '2026-10-21')).counts['2026-10-21'].W01, { mouse: 3, key: 1 });
  assert.equal(coach.snapshot().counts['2026-10-21'].W12, undefined);
});
