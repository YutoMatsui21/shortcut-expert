import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dotnet, dotnetEnvironment } from '../scripts/dotnet.mjs';
import { classify } from '../src/core/detector.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DurableCoach } from '../src/core/durable-coach.ts';
import { SqliteRepository } from '../src/main/sqlite-repository.ts';

mock.module('electron', { namedExports: { app: {} } });
const { candidate, candidateV2 } = await import('../src/main/observer.ts');

test('本番のC#候補生成と全画面分類を人工イベント列で検証する', { timeout: 60_000 }, async (t) => {
  const result = spawnSync(dotnet, ['run', '--project', 'tests/native-policy/WindowObserver.PolicyTests.csproj',
    '--configuration', 'Release', '--verbosity', 'quiet'], {
    env: dotnetEnvironment, encoding: 'utf8', windowsHide: true, timeout: 55_000, maxBuffer: 131_072
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const report = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!);
  assert.equal(report.globalInputCollected, false);
  assert.ok(report.passed.length > 0, 'Native policy suite must not silently discover zero tests');
  t.diagnostic(`C# production policy assertions: ${report.passed.length}`);
  const observations = report.samples.map((sample: unknown) => {
    const parsed = candidate(sample); assert.ok(parsed, 'C# output must satisfy TS protocol'); return classify(parsed);
  });
  assert.equal(observations[0]?.origin, 'mouse');
  assert.equal(observations[0]?.shortcut, 'Win + ↑');
  assert.equal(observations[1]?.origin, 'key');
  assert.deepEqual(observations.slice(2, 4), [null, null], 'Injected input is not a counted operation');
  assert.deepEqual(observations.slice(4).map((value: ReturnType<typeof classify>) => [value?.operation, value?.origin]),
    ['mouse', 'key'].flatMap((origin) => ['W04', 'W04', 'W11', 'W02'].map((id) => [id, origin])));
  const v2 = report.v2Samples.map((sample: unknown) => {
    const parsed = candidateV2(sample); assert.ok(parsed, 'C# v2 output must satisfy strict TS protocol'); return classify(parsed);
  });
  assert.deepEqual(v2.slice(0, observations.length).map((value: ReturnType<typeof classify>) => value && { ...value, id: 'comparison' }),
    observations.map((value: ReturnType<typeof classify>) => value && { ...value, id: 'comparison' }));
  assert.deepEqual(v2.slice(observations.length), [null, null, null]);
  assert.deepEqual(report.snapSamples.map((sample: unknown) => {
    const parsed = candidateV2(sample); assert.ok(parsed, 'historical C# evidence still parses');
    return classify(parsed);
  }), [null, null], 'W08 is excluded from the eight-operation release');
  assert.deepEqual(report.taskbarSamples.map((sample: unknown) => {
    const parsed = candidateV2(sample); assert.ok(parsed); const observed = classify(parsed); assert.ok(observed);
    return [observed.operation, observed.origin, observed.shortcut];
  }), [['W12', 'mouse', 'Win + 0'], ['W12', 'key', 'Win + 1']]);
  assert.deepEqual(report.switchSamples.map((sample: unknown) => {
    const parsed = candidateV2(sample); assert.ok(parsed); const observed = classify(parsed); assert.ok(observed);
    assert.equal(JSON.stringify(parsed).includes('Handle'), false);
    return [observed.operation, observed.origin, observed.shortcut];
  }), [['W01', 'mouse', 'Alt + Tab'], ['W01', 'key', 'Alt + Tab']]);

  const root = await mkdtemp(join(tmpdir(), 'coach-native-state-'));
  const repository = new SqliteRepository(root, resolve('src/main/storage-worker.ts'));
  t.after(async () => { await repository.close(); await rm(root, { recursive: true, force: true }); });
  const totals: Record<string, { mouse: number; key: number }> = {};
  const deliveries: Promise<void>[] = [];
  let notices = 0, expectedNotices = 0;
  const coach = new DurableCoach({ repository, session: repository.session, date: () => '2026-10-28', now: () => 0,
    capabilities: () => [], changed: () => {}, notify: notice => {
      const expected = { ...totals[notice.operation] };
      const delivery = repository.query('2026-10-28', '2026-10-28').then(saved => {
        assert.deepEqual(saved.counts['2026-10-28'][notice.operation], expected, 'SQLite commits before notification');
        notices++;
      });
      deliveries.push(delivery); return delivery.then(() => true);
    } });
  await coach.initialize(); coach.begin(1);
  for (const entry of [...report.windowStateSamples, ...report.placementSamples, ...report.monitorMoveSamples]) {
    const parsed = candidateV2(entry.candidate); assert.ok(parsed, 'new C# state evidence satisfies strict v2 parse');
    const observation = classify(parsed);
    assert.equal(observation?.operation ?? null, entry.expected);
    if (observation) {
      const counts = totals[observation.operation] ??= { mouse: 0, key: 0 };
      counts[observation.origin]++;
      if (observation.origin === 'mouse' && observation.shortcut) expectedNotices++;
    }
    await coach.accept(parsed); await coach.accept(parsed);
    await Promise.all(deliveries);
  }
  assert.deepEqual((await repository.query('2026-10-28', '2026-10-28')).counts['2026-10-28'], totals);
  assert.equal(notices, expectedNotices);
  assert.equal(totals.W03.mouse, 2); assert.ok(totals.W04.key > 0); assert.ok(totals.W04.mouse > 0);
  assert.equal(totals.W05, undefined);
  assert.deepEqual(totals.W06, { mouse: 2, key: 3 });
  assert.deepEqual(totals.W07, { mouse: 4, key: 6 });
  assert.deepEqual(totals.W02, { mouse: 5, key: 5 });
});
