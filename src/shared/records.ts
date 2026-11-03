import type { LearningRow } from "./learning.ts";
export type RecordsPeriod = 7 | 30;
export type RecordsFilter = "learning-mastered" | "learning" | "all";
export type RecordsSort = "rate" | "mouse" | "improvement" | "key" | "total";
export type RecordsQuery = {
  period: RecordsPeriod;
  filter: RecordsFilter;
  sort: RecordsSort;
};
export const defaultRecordsQuery: RecordsQuery = {
  period: 7,
  filter: "learning-mastered",
  sort: "rate",
};
export function isRecordsQuery(value: unknown): value is RecordsQuery {
  if (!value || typeof value !== "object") return false;
  if (!("period" in value) || !("filter" in value) || !("sort" in value))
    return false;
  const query = value;
  return (
    Object.keys(query).sort().join(",") === "filter,period,sort" &&
    (query.period === 7 || query.period === 30) &&
    (query.filter === "learning-mastered" ||
      query.filter === "learning" ||
      query.filter === "all") &&
    (query.sort === "rate" ||
      query.sort === "mouse" ||
      query.sort === "improvement" ||
      query.sort === "key" ||
      query.sort === "total")
  );
}
export type RecordMetrics = {
  mouse: number | null;
  key: number | null;
  total: number | null;
  rate: number | null;
  barRate: number | null;
};
export type RecordComparison = {
  mouse: number | null;
  key: number | null;
  total: number | null;
  improvement: number | null;
  hasMissingCoverage: boolean;
};
export type RecordsReadModel = {
  from: string;
  to: string;
  revision: number;
  query: RecordsQuery;
  priorFrom: string;
  priorTo: string;
  rows: (LearningRow & {
    barRate: number | null;
    previous: RecordMetrics;
    comparison: RecordComparison;
  })[];
  summary: RecordMetrics;
  previous: RecordMetrics;
  comparison: RecordComparison;
};
