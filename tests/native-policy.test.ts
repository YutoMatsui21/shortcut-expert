import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dotnet, dotnetEnvironment } from '../scripts/dotnet.mjs';
import { classify } from '../src/core/detector.ts';

mock.module('electron', { namedExports: { app: {} } });
const { candidate } = await import('../src/main/observer.ts');

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
  assert.deepEqual(observations.slice(2), [null, null], 'Injected input is not a counted operation');
});
