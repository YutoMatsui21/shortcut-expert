import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startupMode } from '../src/main/startup-mode.ts';

test('secondary runner flags cannot enable fixtures, mock notifications or legacy storage', () => {
  for (const argv of [[], ['--activation-smoke', '--activation-failure-smoke'], ['--comparison-smoke'],
    ['--settings-smoke'], ['--ui-acceptance-exit'], ['--observe-consented']]) {
    const mode = startupMode(argv);
    assert.equal(mode.validation, false);
    assert.equal(mode.fixture, false);
    assert.equal(mode.legacyRepository, false);
    assert.equal(mode.activationFailure, false);
    assert.equal(mode.comparison, false);
    assert.equal(mode.systemNotifications, true);
    assert.equal(mode.showTray, true);
  }
});

test('fixture entry points retain storage, notification and tray policies', () => {
  const legacy = startupMode(['--coach-smoke']);
  assert.equal(legacy.legacyRepository, true);
  assert.equal(legacy.systemNotifications, false);
  assert.equal(legacy.showTray, false);
  for (const flag of ['--storage-smoke', '--migration-smoke', '--ui-acceptance', '--os-notification-acceptance']) {
    const mode = startupMode([flag]);
    assert.equal(mode.validation, true);
    assert.equal(mode.fixture, true);
    assert.equal(mode.legacyRepository, false);
    assert.equal(mode.systemNotifications, flag === '--os-notification-acceptance');
    assert.equal(mode.showTray, flag.endsWith('-acceptance'));
  }
  for (const operation of ['w01', 'w08', 'w12']) {
    const mode = startupMode([`--${operation}-natural-acceptance`]);
    assert.equal(mode.validation, true);
    assert.equal(mode.fixture, false, 'natural acceptance must use the real observer');
    assert.equal(mode.legacyRepository, false);
    assert.equal(mode.systemNotifications, true);
  }
});
