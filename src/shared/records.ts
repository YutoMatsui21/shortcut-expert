import type { LearningRow } from './learning.ts';
export type RecordMetrics = { mouse: number | null; key: number | null; total: number | null; rate: number | null; barRate: number | null };
export type RecordsReadModel = {
  from: string; to: string; revision: number;
  rows: (LearningRow & { barRate: number | null })[];
  summary: RecordMetrics;
};
