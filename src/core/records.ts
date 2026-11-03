import type { OperationId, Settings } from "../shared/coach.ts";
import { daysBefore, type RecordRange } from "../shared/storage.ts";
import {
  defaultRecordsQuery,
  type RecordComparison,
  type RecordMetrics,
  type RecordsQuery,
  type RecordsReadModel,
} from "../shared/records.ts";
import { learningOperations, learningState } from "../shared/learning.ts";

type Fraction = { numerator: bigint; denominator: bigint };
function rateFraction(value: RecordMetrics): Fraction | null {
  return value.total
    ? { numerator: BigInt(value.key!) * 100n, denominator: BigInt(value.total) }
    : null;
}
function improvement(
  current: RecordMetrics,
  previous: RecordMetrics,
): Fraction | null {
  const a = rateFraction(current),
    b = rateFraction(previous);
  return a && b
    ? {
        numerator: a.numerator * b.denominator - b.numerator * a.denominator,
        denominator: a.denominator * b.denominator,
      }
    : null;
}
function rounded(value: Fraction): number {
  const sign = value.numerator < 0n ? -1 : 1;
  const absolute = value.numerator < 0n ? -value.numerator : value.numerator;
  const result =
    Number((absolute * 10n + value.denominator / 2n) / value.denominator) / 10;
  return result === 0 ? 0 : sign * result;
}
export function recordMetrics(
  mouse: bigint,
  key: bigint,
  known: boolean,
): RecordMetrics {
  const total = mouse + key;
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("操作回数の合計が安全な範囲を超えています。");
  return {
    mouse: known ? Number(mouse) : null,
    key: known ? Number(key) : null,
    total: known ? Number(total) : null,
    rate: total ? rounded({ numerator: key * 100n, denominator: total }) : null,
    barRate: total ? (Number(key) / Number(total)) * 100 : null,
  };
}
export function recordRanges(today: string, period: 7 | 30) {
  return {
    from: daysBefore(today, period - 1),
    to: today,
    priorFrom: daysBefore(today, period * 2 - 1),
    priorTo: daysBefore(today, period),
  };
}
function aggregate(
  records: RecordRange,
  ids: OperationId[],
  from: string,
  to: string,
) {
  let mouse = 0n,
    key = 0n,
    known = false,
    missing = false;
  for (let day = from; day <= to; day = daysBefore(day, -1)) {
    const next = daysBefore(day, -1);
    const dayMs =
      new Date(next + "T00:00:00").getTime() -
      new Date(day + "T00:00:00").getTime();
    for (const id of ids) {
      const count = records.counts[day]?.[id],
        coverage = records.coverage[day]?.[id];
      if (count) {
        mouse += BigInt(count.mouse);
        key += BigInt(count.key);
        known = true;
      }
      if (coverage?.knowledge === "observed") known = true;
      if (
        !coverage ||
        coverage.knowledge !== "observed" ||
        coverage.gap ||
        coverage.activeMs < dayMs
      )
        missing = true;
    }
  }
  return { metrics: recordMetrics(mouse, key, known), missing };
}
function compare(
  current: RecordMetrics,
  previous: RecordMetrics,
  hasMissingCoverage: boolean,
): RecordComparison {
  const delta = (a: number | null, b: number | null) =>
    a === null || b === null ? null : a - b;
  const difference = improvement(current, previous);
  return {
    mouse: delta(current.mouse, previous.mouse),
    key: delta(current.key, previous.key),
    total: delta(current.total, previous.total),
    improvement: difference ? rounded(difference) : null,
    hasMissingCoverage,
  };
}
export function recordsReadModel(
  records: RecordRange,
  settings: Settings,
  today: string,
  query: RecordsQuery = defaultRecordsQuery,
): RecordsReadModel {
  const ranges = recordRanges(today, query.period);
  const selected = learningOperations.filter(({ id }) => {
    const state = learningState(settings, id);
    return (
      query.filter === "all" ||
      (query.filter === "learning"
        ? state === "learning"
        : state !== "excluded")
    );
  });
  const read = (ids: OperationId[]) => {
    const current = aggregate(records, ids, ranges.from, ranges.to),
      previous = aggregate(records, ids, ranges.priorFrom, ranges.priorTo);
    return {
      ...current.metrics,
      previous: previous.metrics,
      comparison: compare(
        current.metrics,
        previous.metrics,
        current.missing || previous.missing,
      ),
    };
  };
  const rows = selected.map(({ id }) => ({
    id,
    state: learningState(settings, id),
    ...read([id]),
  }));
  // Compare integer fractions before rounding; stable sort retains registry order for exact ties.
  rows.sort((a, b) => {
    const metric = (row: typeof a): Fraction | null =>
      query.sort === "rate"
        ? rateFraction(row)
        : query.sort === "improvement"
          ? improvement(row, row.previous)
          : row[query.sort] === null
            ? null
            : { numerator: BigInt(row[query.sort]!), denominator: 1n };
    const x = metric(a),
      y = metric(b);
    if (!x || !y) return x ? -1 : y ? 1 : 0;
    const difference =
      x.numerator * y.denominator - y.numerator * x.denominator;
    return (
      (difference < 0n ? -1 : difference > 0n ? 1 : 0) *
      (query.sort === "rate" ? 1 : -1)
    );
  });
  const { previous, comparison, ...summary } = read(
    selected.map((op) => op.id),
  );
  return {
    ...ranges,
    revision: records.revision,
    query: { ...query },
    rows,
    summary,
    previous,
    comparison,
  };
}
