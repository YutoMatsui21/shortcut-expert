import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/core/detector.ts';
import { Coach } from '../src/core/coach.ts';
import type { CandidateV2, Evidence, Notice } from '../src/shared/coach.ts';
import { candidateFixture, v2Fixture } from './support/fixtures.ts';
mock.module('electron', { namedExports: { app: {} } });
const { candidateV2 } = await import('../src/main/observer.ts');

test('v2はvariant必須項目を検証し、許可した証拠だけをCoreへ渡す', () => {
  const sample = v2Fixture();
  if (sample.evidence.kind !== 'window') throw new Error('fixture');
  assert.deepEqual(candidateV2(sample), sample);
  assert.deepEqual(candidateV2({ ...sample, title: 'private', evidence: { ...sample.evidence,
    result: { ...sample.evidence.result, path: 'private', before: { state: 'normal', arranged: false, title: 'private' } } } }), sample);
  for (const extra of [{ transaction: 0 }, { transaction: 1.5 }, { sequence: 2 ** 31 }, { generation: 0 },
    { protocolVersion: 3 }, { origin: [] }, { injected: null }, { route: 'x'.repeat(65) },
    { evidence: { kind: 'unknown' } }, { evidence: { kind: 'window', profile: 'future', result: {} } }])
    assert.equal(candidateV2({ ...sample, ...extra }), null);
  assert.equal(sample.evidence.kind, 'window');
  if (sample.evidence.kind !== 'window') throw new Error('fixture');
  for (const field of ['app', 'before', 'after', 'afterArranged', 'monitor', 'fromMonitor', 'toMonitor', 'moveDirection']) {
    const result: Record<string, unknown> = { ...sample.evidence.result }; delete result[field];
    assert.equal(candidateV2({ ...sample, evidence: { ...sample.evidence, result } }), null, field);
  }
});

test('window証拠をenvelopeの余分な同名fieldで成功へ差し替えられない', () => {
  const sample = v2Fixture();
  if (sample.evidence.kind !== 'window') throw new Error('fixture');
  const parsed = candidateV2({ ...sample, targetMatched: true, evidence: { ...sample.evidence,
    result: { ...sample.evidence.result, targetMatched: false } } });
  assert.ok(parsed);
  assert.equal(classify(parsed), null);
});

const reserved: Evidence[] = [
  { kind: 'shell-display', profile: 'unverified', feature: 'task-view', wasVisible: null, visible: null, targetMatched: null },
  { kind: 'activation', profile: 'unverified', slot: null, appMatched: null, targetMatched: null, individualEquivalent: null, result: 'unknown' },
  { kind: 'global', profile: 'unverified', feature: 'desktop', targetsKnown: null, resultConfirmed: null }
];
test('未実証profile・未知能力をfalse successへ変換しない', () => {
  for (const evidence of reserved) {
    const value = { ...v2Fixture(), evidence };
    assert.deepEqual(candidateV2(value), value);
    assert.equal(classify(value), null);
    const claimed = Object.fromEntries(Object.entries(evidence).map(([key, field]) => [key, field === null && key !== 'slot' ? true : field]));
    const unverified = candidateV2({ ...value, evidence: claimed });
    assert.ok(unverified); assert.equal(classify(unverified), null, 'unverified profiles cannot claim success');
    for (const field of Object.keys(evidence)) {
      const missing: Record<string, unknown> = { ...evidence }; delete missing[field];
      assert.equal(candidateV2({ ...value, evidence: missing }), null, `${evidence.kind}.${field}`);
    }
    assert.equal(candidateV2({ ...value, evidence: { ...evidence, profile: 'legacy-window-v1' } }), null);
  }
  const value = v2Fixture(); value.evidence.profile = 'unverified';
  assert.equal(classify(value), null);
});

test('v2でも既存5操作の条件と同等キーを緩めない', () => {
  const fromMonitor = { x: -1920, y: 0, width: 1920, height: 1080 };
  const toMonitor = { ...fromMonitor, x: 0 };
  for (const origin of ['mouse', 'key'] as const) {
    const cases = [
      candidateFixture({ origin, route: origin === 'mouse' ? 'max-button' : 'win-up' }),
      candidateFixture({ origin, operation: 'minimize', after: { state: 'minimized' }, route: origin === 'mouse' ? 'min-button' : 'win-down' }),
      candidateFixture({ origin, operation: 'restore', before: { state: 'maximized', arranged: false }, after: { state: 'normal' }, afterArranged: false, route: origin === 'mouse' ? 'max-button' : 'win-down' }),
      candidateFixture({ origin, operation: 'close', after: { state: 'closed' }, route: origin === 'mouse' ? 'close-button' : 'alt-f4' }),
      candidateFixture({ origin, operation: 'monitor-move', moveConfirmed: true, afterArranged: false, after: { state: 'normal' }, fromMonitor, toMonitor, moveDirection: 'right', route: origin === 'mouse' ? 'caption-drag' : 'win-shift-right' })
    ];
    for (const legacy of cases) {
      const value = v2Fixture(legacy);
      const observation = classify(value)!;
      assert.deepEqual({ ...observation, id: '1:1' }, classify(legacy));
      for (const invalid of [{ injected: true }, { conflicted: true }, { origin: 'unknown' as const }, { route: 'unverified-route' }])
        assert.equal(classify({ ...value, ...invalid }), null);
      for (const invalid of [{ inputAgeMs: 1001 }, { targetMatched: false }, { elevated: true }, { moving: true }]) {
        assert.equal(value.evidence.kind, 'window');
        if (value.evidence.kind === 'window') assert.equal(classify({ ...value, evidence: { ...value.evidence, result: { ...value.evidence.result, ...invalid } } }), null);
      }
    }
  }
  const arranged = v2Fixture(candidateFixture({ before: { state: 'normal', arranged: true } }));
  assert.equal(classify(arranged)?.shortcut, null);
});

test('Coreは完了順を採用し、transaction/sequenceの再配送・差替え・旧世代・protocol混在を拒否する', async () => {
  const notices: Notice[] = [];
  const coach = new Coach({ repository: { load: async () => ({ counts: {}, settings: { muted: [], opened: false } }),
    saveCounts: async () => {}, saveSettings: async () => {} }, date: () => '2026-10-11', now: () => 0,
    notify: async (notice) => { notices.push(notice); return true; }, changed: () => {} });
  await coach.initialize(); coach.begin(1);
  const event = (sequence: number, transaction: number): CandidateV2 => v2Fixture(candidateFixture({ sequence }), transaction);
  await coach.accept(event(1, 2)); await coach.accept(event(2, 1)); // late completion of an earlier input
  await coach.accept(event(3, 2)); // same input, new sequence
  await coach.accept(event(3, 3)); // same sequence, replacement content
  await coach.accept({ ...event(4, 4), generation: 2 });
  await coach.accept(candidateFixture({ sequence: 5 }));
  await coach.accept({ ...event(6, 6), evidence: reserved[0] });
  await coach.accept(event(7, 6)); // excluded transaction cannot become success
  assert.equal(coach.snapshot().counts['2026-10-11'].W03?.mouse, 2);
  assert.equal(notices.length, 1);
  await coach.accept(event(8, 5000)); await coach.accept(event(9, 1)); // retired tombstone
  coach.stop(); await coach.accept(event(10, 10));
  coach.begin(2); await coach.accept({ ...event(1, 1), generation: 2 });
  assert.equal(coach.snapshot().counts['2026-10-11'].W03?.mouse, 4);
  coach.stop(); coach.begin(3);
  await coach.accept(candidateFixture({ generation: 3 }));
  await coach.accept({ ...event(2, 2), generation: 3 });
  assert.equal(coach.snapshot().counts['2026-10-11'].W03?.mouse, 5);
});

test('直列化待ちの候補を呼出し元から差し替えられない', async () => {
  const coach = new Coach({ repository: { load: async () => ({ counts: {}, settings: { muted: [], opened: false } }),
    saveCounts: async () => {}, saveSettings: async () => {} }, date: () => '2026-10-11', now: () => 0,
    notify: async () => false, changed: () => {} });
  await coach.initialize(); coach.begin(1);
  const value = v2Fixture(); const accepting = coach.accept(value); value.origin = 'key';
  await accepting;
  assert.deepEqual(coach.snapshot().counts['2026-10-11'].W03, { mouse: 1, key: 0 });
});
