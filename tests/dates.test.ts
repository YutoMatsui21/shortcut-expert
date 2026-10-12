import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validDate, cutoffDate, localDate } from '../src/core/dates.ts';

test('日付形式と実在する閏日・月境界を区別する', () => {
  for (const date of ['2024-02-29', '2000-02-29', '2026-12-31']) assert.equal(validDate(date), true, date);
  for (const date of ['1900-02-29', '2026-02-29', '2026-04-31', '2026-1-01', '2026-01-00', '', 'invalid']) assert.equal(validDate(date), false, date);
});

test('今日を含む30暦日の開始日を月末・年末・閏年で計算する', () => {
  for (const [today, cutoff] of [['2026-01-01', '2025-12-03'], ['2024-03-01', '2024-02-01'], ['2026-03-01', '2026-01-31']])
    assert.equal(cutoffDate(today), cutoff);
});

test('ローカル暦日を時刻やUTC表記へ置き換えず返す', () => {
  assert.equal(localDate(new Date(2026, 0, 1, 0, 0, 1)), '2026-01-01');
  assert.equal(localDate(new Date(2026, 11, 31, 23, 59, 59)), '2026-12-31');
});
