import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('全画面判定は通常最大化とcloaked窓を除外し、全画面と不明窓は抑制する', () => {
  const result = spawnSync(resolve('resources/native-helper/WindowObserver.exe'), ['--display-policy-test'], {
    encoding: 'utf8', windowsHide: true, timeout: 10_000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    maximized: 'ordinary', cloaked: 'hidden', fullscreen: 'fullscreen',
    borderlessMaximized: 'fullscreen', unknown: 'unknown', hiddenWithoutBounds: 'hidden', ordinary: 'ordinary'
  });
});

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
    input: '{"command":"start","requestId":1,"generation":1}\n', encoding: 'utf8', windowsHide: true, timeout: 10_000
  });
  assert.equal(result.status, 0, result.stderr);
  const messages = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.deepEqual(messages.map((message) => message.type), ['ready', 'started']);
  assert.equal(typeof messages[0].arrangedAvailable, 'boolean');
});
