import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learningReadModel } from '../../src/core/learning.ts';
import { learningOperations } from '../../src/shared/learning.ts';
import type { RecordRange } from '../../src/shared/storage.ts';

test('正式8操作は旧IDの対応を保ち、2/2/3/1で準備中。旧mutedは独立した対象外表示', () => {
  assert.deepEqual(learningOperations.map(op => op.id), ['W12', 'W01', 'W03', 'W04', 'W06', 'W07', 'W02', 'W11']);
  assert.deepEqual([0, 1, 2, 3].map(group => learningOperations.filter(op => op.group === group).length), [2, 2, 3, 1]);
  assert.ok(learningOperations.every(op => op.availability === 'preparing'));
  const model = learningReadModel({ counts: {}, coverage: {}, revision: 4 }, { muted: ['W03', 'W09'], opened: true }, '2026-10-19');
  assert.equal(model.rows.find(row => row.id === 'W03')?.state, 'excluded');
  assert.equal(model.rows.filter(row => row.state === 'learning').length, 7);
  assert.equal(model.rows.filter(row => row.state === 'mastered').length, 0);
});

test('一覧は今日を含む7暦日のみ集計し、0%・既知0・未観測・legacyを区別する', () => {
  const records: RecordRange = { revision: 7, counts: {
    '2026-10-12': { W03: { mouse: 500, key: 0 } },
    '2026-10-13': { W03: { mouse: 2, key: 1 }, W01: { mouse: 5, key: 0 } },
    '2026-10-19': { W03: { mouse: 0, key: 1 } },
    '2026-10-20': { W03: { mouse: 0, key: 500 } }
  }, coverage: { '2026-10-19': {
    W02: { knowledge: 'observed', activeMs: 1000, gap: true, capabilityRevision: 'fixture' },
    W12: { knowledge: 'legacy-unknown', activeMs: 0, gap: true, capabilityRevision: '' }
  } } };
  const before = structuredClone(records);
  const result = learningReadModel(records, { muted: [], opened: true }, '2026-10-19');
  const row = (id: string) => result.rows.find(row => row.id === id)!;
  assert.equal(result.from, '2026-10-13');
  assert.equal(row('W03').rate, 50); assert.equal(row('W03').total, 4);
  assert.equal(row('W01').rate, 0); assert.equal(row('W01').total, 5);
  assert.equal(row('W02').rate, null); assert.equal(row('W02').total, 0);
  assert.equal(row('W12').total, null); assert.equal(result.rows.some(row => row.id === 'W13'), false);
  assert.deepEqual(records, before);
  assert.equal(learningReadModel(records, { muted: [], opened: true }, '2026-10-26').rows.find(row => row.id === 'W01')?.total, null);
});

test('暦日境界・小数1桁四捨五入・安全整数超過を扱う', () => {
  const settings = { muted: [], opened: true };
  const model = learningReadModel({ counts: { '2024-02-29': { W03: { mouse: 31, key: 1 } } }, coverage: {}, revision: 0 }, settings, '2024-03-06');
  assert.equal(model.from, '2024-02-29');
  assert.equal(model.rows.find(row => row.id === 'W03')?.rate, 3.1);
  assert.throws(() => learningReadModel({ counts: { '2026-10-19': { W03: { mouse: Number.MAX_SAFE_INTEGER, key: 1 } } }, coverage: {}, revision: 0 }, settings, '2026-10-19'), /安全/);
});
