import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dotnet, dotnetEnvironment } from '../scripts/dotnet.mjs';
import { classify } from '../src/core/detector.ts';

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
    ['mouse', 'key'].flatMap((origin) => ['W04', 'W05', 'W11', 'W02'].map((id) => [id, origin])));
  const v2 = report.v2Samples.map((sample: unknown) => {
    const parsed = candidateV2(sample); assert.ok(parsed, 'C# v2 output must satisfy strict TS protocol'); return classify(parsed);
  });
  assert.deepEqual(v2.slice(0, observations.length).map((value: ReturnType<typeof classify>) => value && { ...value, id: 'comparison' }),
    observations.map((value: ReturnType<typeof classify>) => value && { ...value, id: 'comparison' }));
  assert.deepEqual(v2.slice(observations.length), [null, null, null]);
  assert.deepEqual(report.snapSamples.map((sample: unknown) => {
    const parsed = candidateV2(sample); assert.ok(parsed); const observed = classify(parsed);
    assert.ok(observed); assert.equal(observed.shortcut, 'Win + Z');
    return [observed.id, observed.operation, observed.origin];
  }), [['1:t1', 'W08', 'mouse'], ['1:t2', 'W08', 'key']]);
  assert.deepEqual(report.taskbarSamples.map((sample: unknown) => {
    const parsed = candidateV2(sample); assert.ok(parsed); const observed = classify(parsed); assert.ok(observed);
    return [observed.operation, observed.origin, observed.shortcut];
  }), [['W12', 'mouse', 'Win + 0'], ['W12', 'key', 'Win + 1']]);
  assert.deepEqual(report.switchSamples.map((sample: unknown) => {
    const parsed = candidateV2(sample); assert.ok(parsed); const observed = classify(parsed); assert.ok(observed);
    assert.equal(JSON.stringify(parsed).includes('Handle'), false);
    return [observed.operation, observed.origin, observed.shortcut];
  }), [['W01', 'mouse', 'Alt + Tab'], ['W01', 'key', 'Alt + Tab']]);
});
