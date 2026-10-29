import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify as classifyV2 } from '../src/core/detector.ts';
import { v2Fixture, type Candidate } from './support/fixtures.ts';

const classify = (value: Candidate) => classifyV2(v2Fixture(value));

export function maximize(overrides: Partial<Candidate> = {}): Candidate {
  return {
    type: 'candidate', protocolVersion: 1, generation: 1, sequence: 1,
    app: 'chrome', operation: 'maximize', date: '2026-10-11',
    before: { state: 'normal', arranged: false }, after: { state: 'maximized' },
    origin: 'mouse', route: 'max-button', injected: false, conflicted: false,
    moving: false, elevated: false, targetMatched: true, inputAgeMs: 135,
    monitor: { x: 0, y: 0, width: 1920, height: 1080 }, ...overrides
  };
}

test('通常窓の最大化ボタンと最大化結果が対応するとW03を返す', () => {
  assert.deepEqual(classify(maximize()), {
    id: '1:t1', operation: 'W03', origin: 'mouse', date: '2026-10-11',
    shortcut: 'Win + ↑', monitor: { x: 0, y: 0, width: 1920, height: 1080 }
  });
});

test('入力由来・同等キーの証拠が不足する最大化は数えない', () => {
  const excluded: Partial<Candidate>[] = [
    { elevated: true }, { origin: 'unknown' }, { injected: true }, { conflicted: true },
    { targetMatched: false }, { moving: true }, { inputAgeMs: 1001 },
    { inputAgeMs: -1 }, { app: 'codex' }, { operation: 'restore' },
    { route: 'client-click' }, { origin: 'key', route: 'Win+F11' },
    { before: { state: 'normal', arranged: null } },
    { after: { state: 'normal' } }
  ];
  for (const value of excluded) assert.equal(classify(maximize(value)), null, JSON.stringify(value));
});

test('スナップ窓の最大化結果も記録し、未確認の同等キーは案内しない', () => {
  const result = classify(maximize({ before: { state: 'normal', arranged: true } }));
  assert.equal(result?.operation, 'W03');
  assert.equal(result?.origin, 'mouse');
  assert.equal(result?.shortcut, null);
});

for (const app of ['chrome', 'obsidian', 'code', 'chatgpt']) {
  test(`${app}の最大化はmax button・caption double click・Win+Upの成立条件で判定する`, () => {
    assert.equal(classify(maximize({ app, route: 'caption-double-click' }))?.shortcut, 'Win + ↑');
    assert.equal(classify(maximize({ app, origin: 'key', route: 'win-up' }))?.origin, 'key');
    assert.equal(classify(maximize({ app, inputAgeMs: 1000 }))?.operation, 'W03');
  });
}

test('日付とsequenceの境界が不正な候補を数えない', () => {
  for (const overrides of [{ date: '2026-02-30' }, { sequence: 0 }, { sequence: -1 }, { sequence: 0.5 }, { sequence: NaN }])
    assert.equal(classify(maximize(overrides)), null);
  assert.equal(classify(maximize({ monitor: null }))?.monitor, null, '画面不明でも成立した観測の集計は可能');
});
