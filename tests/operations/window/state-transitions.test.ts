import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify as classifyV2 } from '../../../src/core/detector.ts';
import { candidateFixture, v2Fixture, type Candidate } from '../../support/fixtures.ts';

const classify = (value: Candidate) => classifyV2(v2Fixture(value));

test('W03 top drag requires a confirmed same-monitor terminal result', () => {
  const screen = { x: 0, y: -1080, width: 1920, height: 1080 };
  const drag = candidateFixture({ route: 'caption-top-drag', fromMonitor: screen, toMonitor: screen });
  assert.equal(classify(drag)?.operation, 'W03');
  for (const invalid of [
    { fromMonitor: null }, { toMonitor: null },
    { toMonitor: { ...screen, y: 0 } }, { moving: true }, { conflicted: true },
    { before: { state: 'normal', arranged: true } }, { after: { state: 'normal' } },
    { origin: 'key' as const }, { route: 'snap-layout-selection' }
  ]) assert.equal(classify({ ...drag, ...invalid }), null, JSON.stringify(invalid));
});

test('W03 and W04 keep separate learning identities and correct minimize guidance', () => {
  assert.equal(classify(candidateFixture())?.operation, 'W03');
  const min = candidateFixture({ operation: 'minimize', route: 'min-button', after: { state: 'minimized' },
    before: { state: 'maximized', arranged: false } });
  assert.equal(classify(min)?.operation, 'W04');
  assert.equal(classify(min)?.shortcut, 'Win + ↓（必要に応じて繰り返す）');
  for (const route of ['win-m', 'win-d', 'caption-drag', 'win-shift-down'])
    assert.equal(classify({ ...min, origin: 'key', route }), null);
});
