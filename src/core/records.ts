import type { Settings } from '../shared/coach.ts';
import type { RecordRange } from '../shared/storage.ts';
import type { RecordMetrics, RecordsReadModel } from '../shared/records.ts';
import { learningReadModel } from './learning.ts';

export function recordMetrics(mouse: bigint, key: bigint, known: boolean): RecordMetrics {
  const total = mouse + key;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('操作回数の合計が安全な範囲を超えています。');
  return { mouse: known ? Number(mouse) : null, key: known ? Number(key) : null, total: known ? Number(total) : null,
    rate: total ? Number((key * 1000n + total / 2n) / total) / 10 : null,
    barRate: total ? Number(key) / Number(total) * 100 : null };
}

export function recordsReadModel(records: RecordRange, settings: Settings, today: string): RecordsReadModel {
  const model = learningReadModel(records, settings, today);
  let mouse = 0n, key = 0n, known = false;
  const rows = model.rows.map(row => {
    mouse += BigInt(row.mouse ?? 0); key += BigInt(row.key ?? 0);
    known ||= row.total !== null;
    return { ...row, barRate: row.total ? (row.key! / row.total) * 100 : null };
  });
  return { ...model, rows, summary: recordMetrics(mouse, key, known) };
}
