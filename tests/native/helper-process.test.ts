import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { candidateFixture, v2Fixture } from './support/fixtures.ts';

test('Windows helperはhookを登録・解除でき、テスト中は入力payloadを読まない', () => {
  const result = spawnSync(resolve('resources/native-helper/WindowObserver.exe'), ['--self-test'], {
    encoding: 'utf8', windowsHide: true, timeout: 10_000
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report, { type: 'self-test', hooksStarted: true, hooksStopped: true, globalInputCollected: false });
});

test('テスト用helperは親のstdin終了でhookを残さず終了する', () => {
  const result = spawnSync(resolve('resources/native-helper/WindowObserver.exe'), ['--fixture'], {
    input: '{"command":"start","requestId":1,"generation":1,"protocolVersion":2}\n', encoding: 'utf8', windowsHide: true, timeout: 10_000
  });
  assert.equal(result.status, 0, result.stderr);
  const messages = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.deepEqual(messages.map((message) => message.type), ['ready', 'started']);
  assert.equal(typeof messages[0].arrangedAvailable, 'boolean');
});

test('実helperのv2で開始・候補・停止・再開・終了を確認できる', { timeout: 10_000 }, async (t) => {
  const child = spawn(resolve('resources/native-helper/WindowObserver.exe'), ['--fixture'], {
    windowsHide: true, stdio: 'pipe'
  });
  const lines = createInterface({ input: child.stdout });
  t.after(() => { lines.close(); if (child.exitCode === null) child.kill(); });
  let errors = '';
  child.stderr.setEncoding('utf8').on('data', (text) => { errors += text; });
  const exit = once(child, 'exit');
  const messages = lines[Symbol.asyncIterator]();
  const receive = async () => {
    const next = await messages.next();
    assert.equal(next.done, false, errors);
    return JSON.parse(next.value!);
  };
  const ready = await receive();
  assert.equal(ready.type, 'ready');
  assert.equal(ready.protocolVersion, 2);
  for (const [command, requestId, generation, type] of [
    ['start', 1, 1, 'started'], ['stop', 2, 1, 'stopped'],
    ['start', 3, 2, 'started'], ['shutdown', 4, 2, 'stopped']
  ] as const) {
    child.stdin.write(JSON.stringify({ command, requestId, generation, protocolVersion: 2 }) + '\n');
    assert.deepEqual(await receive(), { type, requestId });
    if (command === 'start') {
      child.stdin.write(JSON.stringify({ command: 'fixtureCandidate', requestId: requestId + 100, candidate: v2Fixture(candidateFixture({ generation })) }) + '\n');
      const candidate = await receive();
      assert.equal(candidate.protocolVersion, 2);
      assert.equal(candidate.generation, generation);
      assert.equal(candidate.sequence, 1);
      assert.equal(candidate.transaction, 1);
      assert.equal(candidate.evidence.kind, 'window');
      assert.equal(candidate.evidence.profile, 'legacy-window-v1');
      assert.equal(candidate.evidence.result.targetMatched, true);
      assert.deepEqual(await receive(), { type: 'injected', requestId: requestId + 100 });
    }
  }
  assert.deepEqual(await exit, [0, null], errors);
  assert.equal((await messages.next()).done, true);
});

test('実helperは旧protocolとversion省略を拒否する', () => {
  for (const extra of [{ protocolVersion: 1 }, {}]) {
    const result = spawnSync(resolve('resources/native-helper/WindowObserver.exe'), ['--fixture'], {
      input: JSON.stringify({ command: 'start', requestId: 1, generation: 1, ...extra }) + '\n',
      encoding: 'utf8', windowsHide: true, timeout: 10_000
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line).type), ['ready', 'fault']);
  }
});

test('実helperは旧fixtureをv2へ暗黙変換しない', () => {
  const commands = [
    { command: 'start', requestId: 1, generation: 1, protocolVersion: 2 },
    { command: 'fixtureCandidate', requestId: 2, candidate: candidateFixture() }
  ];
  const result = spawnSync(resolve('resources/native-helper/WindowObserver.exe'), ['--fixture'], {
    input: commands.map(value => JSON.stringify(value)).join('\n') + '\n',
    encoding: 'utf8', windowsHide: true, timeout: 10_000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line).type), ['ready', 'started', 'fault']);
});
