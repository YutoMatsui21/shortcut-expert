import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { deferred } from './support/fixtures.ts';
import type { Snapshot } from '../src/shared/coach.ts';

let readNext: () => Promise<string>;
let lastStatus: { results: { valid: boolean }[] };
mock.module('node:fs/promises', { namedExports: {
  readFile: () => readNext(), writeFile: async (_path: string, text: string) => { lastStatus = JSON.parse(text); }, rename: async () => {}
} });
const { runW08NaturalAcceptance } = await import('../src/main/w08-natural-acceptance.ts');

test('blocked file reads cannot allow late FINISH or cancel the session shutdown retry', async t => {
  for (const sessionExpiry of [false, true]) {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const heldRead = deferred<string>(); let reads = 0, quit = 0;
    const snapshot: Snapshot = { counts: {}, settings: { muted: [], opened: true, states: { W08: 'learning' } },
      observing: false, notificationsPaused: false, error: null, pendingSave: false };
    readNext = async () => ++reads === 1 ? JSON.stringify({ sequence: 1, action: 'arm',
      plan: { kind: 'negative', application: 'standard', state: 'learning', paused: false } }) : heldRead.promise;
    const controller = runW08NaturalAcceptance('isolated-fixture', {
      snapshot: () => snapshot, configure: async () => {}, idle: async () => {},
      start: async () => { snapshot.observing = true; }, stop: async () => { snapshot.observing = false; }
    }, async () => { quit++; });
    await setImmediate(); t.mock.timers.tick(150); await setImmediate();
    assert.equal(snapshot.observing, true);
    t.mock.timers.tick(150); await setImmediate(); // hold an actual coordinator read across expiration
    t.mock.timers.tick(sessionExpiry ? 20 * 60_000 : 45_000); await setImmediate();
    assert.equal(snapshot.observing, false, 'deadline stops observation despite stalled file I/O');
    heldRead.resolve(JSON.stringify({ sequence: 2, action: 'finish' }));
    await setImmediate(); t.mock.timers.tick(100); await setImmediate();
    assert.equal(lastStatus.results[0].valid, false, 'late FINISH remains invalid');
    assert.equal(quit, sessionExpiry ? 1 : 0, 'late FINISH cannot cancel mandatory session shutdown');
    controller.dispose(); t.mock.timers.reset();
  }
});
