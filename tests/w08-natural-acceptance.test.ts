import { test } from 'node:test';
import assert from 'node:assert/strict';
import { W08NaturalTrials } from '../src/main/w08-natural-acceptance.ts';
import type { Snapshot } from '../src/shared/coach.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DurableCoach } from '../src/core/durable-coach.ts';
import { SqliteRepository } from '../src/main/sqlite-repository.ts';
import { snapFixture, candidateFixture, v2Fixture } from './support/fixtures.ts';

function harness() {
  const snapshot: Snapshot = { counts: {}, settings: { muted: [], opened: true }, observing: false,
    notificationsPaused: false, error: null, pendingSave: false };
  let starts = 0, stops = 0, now = 0;
  const trials = new W08NaturalTrials({ snapshot: () => snapshot, idle: async () => {},
    now: () => now,
    start: async paused => { starts++; snapshot.observing = true; snapshot.notificationsPaused = paused; },
    stop: async () => { stops++; snapshot.observing = false; },
    configure: async state => { snapshot.settings.states = { W08: state }; } });
  return { snapshot, trials, starts: () => starts, stops: () => stops, time: (value: number) => { now = value; } };
}
const plan = { kind: 'mouse', application: 'standard', state: 'learning', paused: false };
test('natural trial starts only on valid ARM, counts a single trial delta and stops before reporting', async () => {
  const h = harness(); assert.equal(h.starts(), 0);
  for (const invalid of [null, {}, { ...plan, kind: 'synthetic' }, { ...plan, paused: 1 }, { ...plan, state: 'invalid' }])
    await assert.rejects(h.trials.arm(invalid));
  assert.equal(h.starts(), 0);
  h.snapshot.counts = { '2026-10-23': { W08: { mouse: 4, key: 2 } } };
  await h.trials.arm(plan); assert.equal(h.starts(), 1);
  await assert.rejects(h.trials.arm(plan));
  h.snapshot.counts['2026-10-24'] = { W08: { mouse: 1, key: 0 } };
  h.trials.noticeRequested('W08');
  await h.trials.finish(true);
  assert.equal(h.snapshot.observing, false); assert.equal(h.trials.armed, false);
  assert.deepEqual(h.trials.results, [{ trial: 1, ...plan, completed: true, valid: true, interrupted: false, expired: false, counts: { mouse: 1, key: 0 },
    notificationRequests: 1, detectorPassed: true, notificationRequestPassed: true }]);
});
test('interruptions remain invalid after recovery and deadline cannot become a late FINISH pass', async () => {
  for (const scenario of ['stop', 'recovered-fault', 'deadline', 'latched-expiration']) {
    const h = harness(); await h.trials.arm({ ...plan, kind: 'negative' });
    if (scenario === 'deadline') h.time(45_000);
    else if (scenario === 'latched-expiration') h.trials.expire();
    else {
      h.trials.observe({ ...h.snapshot, observing: false, error: scenario === 'stop' ? null : 'fixture fault' });
      h.trials.observe(h.snapshot); // recovery cannot erase the interruption
    }
    await h.trials.finish(true);
    assert.equal((h.trials.results[0] as { valid: boolean }).valid, false, scenario);
  }
});
test('manual negative, incorrect input, timeout/cancel, storage fault and suppressed notification have distinct outcomes', async () => {
  for (const scenario of ['negative', 'incorrect', 'timeout', 'fault', 'mastered', 'paused']) {
    const h = harness();
    const p = { ...plan, kind: scenario === 'negative' ? 'negative' : 'mouse',
      state: scenario === 'mastered' ? 'mastered' : 'learning', paused: scenario === 'paused' };
    await h.trials.arm(p);
    if (scenario !== 'negative') h.snapshot.counts['2026-10-24'] = { W08: { mouse: scenario === 'incorrect' ? 2 : 1, key: 0 } };
    if (scenario === 'fault') { h.snapshot.pendingSave = true; h.snapshot.error = 'fixture error'; }
    if (!['negative', 'mastered', 'paused'].includes(scenario)) h.trials.noticeRequested('W08');
    await h.trials.finish(scenario !== 'timeout');
    const result = h.trials.results[0] as { valid: boolean; detectorPassed: boolean; notificationRequestPassed: boolean };
    assert.equal(result.valid, !['timeout', 'fault'].includes(scenario), scenario);
    assert.equal(result.detectorPassed, !['timeout', 'fault', 'incorrect'].includes(scenario), scenario);
    assert.equal(result.notificationRequestPassed, !['timeout', 'fault'].includes(scenario), scenario);
  }
});
test('real DurableCoach/SQLite: apply pause after begin, ignore W03 requests and preserve interrupted negatives', async t => {
  const root = await mkdtemp(join(tmpdir(), 'w08-natural-fixture-'));
  const repository = new SqliteRepository(root, resolve('src/main/storage-worker.ts'));
  t.after(async () => { await repository.close(); await rm(root, { force: true, recursive: true }); });
  let trials: W08NaturalTrials | undefined, generation = 0;
  const coach = new DurableCoach({ repository, session: repository.session, date: () => '2026-10-21', now: () => 0,
    capabilities: () => [], changed: snapshot => trials?.observe(snapshot),
    notify: async notice => { trials?.noticeRequested(notice.operation); return true; } });
  await coach.initialize();
  trials = new W08NaturalTrials({ snapshot: () => coach.snapshot(), configure: state => coach.setLearningState('W08', state),
    start: async paused => { coach.begin(++generation); coach.pauseNotifications(paused); },
    stop: async () => { coach.stop(); }, idle: () => coach.idle() });
  for (const paused of [true, false]) {
    await trials.arm({ ...plan, paused });
    assert.equal(coach.snapshot().notificationsPaused, paused);
    await coach.accept({ ...snapFixture(), generation });
    await trials.finish(true);
    assert.equal((trials.results.at(-1) as { valid: boolean }).valid, true);
    assert.equal((trials.results.at(-1) as { notificationRequestPassed: boolean }).notificationRequestPassed, true);
  }
  await trials.arm({ ...plan, kind: 'negative' });
  await coach.accept({ ...v2Fixture(candidateFixture({ date: '2026-10-21' })), generation });
  await trials.finish(true);
  assert.equal((trials.results.at(-1) as { notificationRequestPassed: boolean }).notificationRequestPassed, true);
  await trials.arm({ ...plan, kind: 'negative' });
  coach.stop(); // actual production publish during a manually interrupted trial
  await trials.finish(true);
  assert.equal((trials.results.at(-1) as { valid: boolean }).valid, false);
});
