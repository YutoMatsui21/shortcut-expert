import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordsReadModel } from '../src/core/records.ts';
import type { RecordRange } from '../src/shared/storage.ts';

const settings = { muted: [], opened: true };
test('7 local calendar days: weighted KPI, twelve rows, legacy values, no synthetic zeros', () => {
  const records: RecordRange = { counts: {
    '2024-02-28': { W03: { mouse: 100, key: 100 } },
    '2024-02-29': { W03: { mouse: 3, key: 1 }, W01: { mouse: 0, key: 6 }, W09: { mouse: 100, key: 100 } },
    '2024-03-06': { W03: { mouse: 1, key: 0 } },
    '2024-03-07': { W03: { mouse: 100, key: 100 } }
  }, coverage: { '2024-03-06': {
    W02: { knowledge: 'observed', activeMs: 1000, gap: true, capabilityRevision: 'fixture' },
    W13: { knowledge: 'not-observed', activeMs: 0, gap: true, capabilityRevision: 'unverified' }
  } }, revision: 19 };
  const original = structuredClone(records);
  const value = recordsReadModel(records, settings, '2024-03-06');
  assert.equal(value.from, '2024-02-29'); assert.equal(value.to, '2024-03-06'); assert.equal(value.revision, 19);
  assert.equal(value.rows.length, 12);
  assert.deepEqual(value.summary, { mouse: 4, key: 7, total: 11, rate: 63.6, barRate: 7 / 11 * 100 });
  assert.equal(value.rows.find(row => row.id === 'W03')?.rate, 20);
  assert.equal(value.rows.find(row => row.id === 'W02')?.total, 0);
  assert.equal(value.rows.find(row => row.id === 'W02')?.rate, null);
  assert.equal(value.rows.find(row => row.id === 'W13')?.total, null);
  assert.deepEqual(records, original);
});
test('empty, observed zero and valid zero percent remain distinct', () => {
  const records: RecordRange = { counts: {}, coverage: {}, revision: 0 };
  assert.equal(recordsReadModel(records, settings, '2026-01-01').summary.total, null);
  records.coverage['2026-01-01'] = { W03: { knowledge: 'observed', activeMs: 1, gap: true, capabilityRevision: 'fixture' } };
  assert.equal(recordsReadModel(records, settings, '2026-01-01').summary.total, 0);
  assert.equal(recordsReadModel(records, settings, '2026-01-01').summary.rate, null);
  records.counts['2026-01-01'] = { W03: { mouse: 8, key: 0 } };
  assert.equal(recordsReadModel(records, settings, '2026-01-01').summary.rate, 0);
  assert.equal(recordsReadModel(records, settings, '2026-01-08').summary.total, null);
});
test('BigInt rounding, unrounded bar and aggregate overflow across operations', () => {
  const records: RecordRange = { counts: { '2026-01-01': { W03: { mouse: 29, key: 3 } } }, coverage: {}, revision: 0 };
  const value = recordsReadModel(records, settings, '2026-01-01');
  assert.equal(value.summary.rate, 9.4); assert.equal(value.summary.barRate, 9.375);
  records.counts['2026-01-01'] = { W03: { mouse: Number.MAX_SAFE_INTEGER - 1, key: 1 } };
  assert.equal(recordsReadModel(records, settings, '2026-01-01').summary.total, Number.MAX_SAFE_INTEGER);
  records.counts['2026-01-01'].W01 = { mouse: 1, key: 0 };
  assert.throws(() => recordsReadModel(records, settings, '2026-01-01'), /安全/);
});
