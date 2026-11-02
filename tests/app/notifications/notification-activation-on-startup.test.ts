import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { deferred } from '../../support/fixtures.ts';

test('identity and global activation precede initialization; cold and second-instance use the common display request', async () => {
  const ready = deferred<void>(), started = deferred<void>(), initialized = deferred<void>();
  const calls: string[] = []; let displays = 0;
  let activate: (() => void) | undefined;
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    getPath: () => 'fixture-user-data', setPath: () => {},
    requestSingleInstanceLock: () => true,
    whenReady: () => ready.promise,
    setAppUserModelId: (id: string) => calls.push(id),
    exit: () => assert.fail('unexpected exit')
  });
  class Notification {
    constructor() { calls.push('presenter'); }
    removeAllListeners() { calls.push('release'); }
    static handleActivation(callback: () => void) { activate = callback; callback(); calls.push('activation'); }
  }
  mock.module('electron', { namedExports: { app, Notification, dialog: {} } });
  mock.module('node:fs', { namedExports: { mkdirSync: () => {}, mkdtempSync: () => 'fixture', readdirSync: () => [] } });
  mock.module('../../../src/main/coach-app.ts', { namedExports: {
    runCoach: async () => { calls.push('run'); assert.equal(displays, 2, 'early cold request reaches the shared display function'); started.resolve(); await initialized.promise; },
    showCoach: () => displays++
  } });
  await import('../../../src/main/index.ts');
  assert.deepEqual(calls, []);
  ready.resolve(); await started.promise;
  assert.deepEqual(calls, ['local.window-shortcut-coach', 'activation', 'presenter', 'run']);
  activate?.(); app.emit('second-instance', {}, [], '');
  assert.equal(displays, 4);
  assert.equal(calls.filter(value => value === 'run').length, 1, 'callbacks cannot start another helper or observation');
  initialized.resolve(); await Promise.resolve();
  activate?.(); app.emit('second-instance', {}, [], '');
  assert.equal(displays, 6, 'late COM activation still shows the existing window');
  assert.equal(calls.filter(value => value === 'run').length, 1);
  app.emit('will-quit');
  assert.equal(calls.at(-1), 'release');
});
