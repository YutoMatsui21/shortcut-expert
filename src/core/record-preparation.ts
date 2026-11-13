import type { OperationId } from "../shared/coach.ts";
import type {
  Coverage,
  CoverageDays,
  RecordMutation,
  StorageState,
} from "../shared/storage.ts";
import { recordOperations } from "../shared/storage.ts";

export type Capability = { operation: OperationId; revision: string };
export type RecordingBaseline = {
  day: string;
  time: number;
  observing: boolean;
  capabilities: Capability[];
};
type Interval = {
  previous: RecordingBaseline | null;
  current: RecordingBaseline;
};
type RecordChange = {
  counts: NonNullable<RecordMutation["counts"]>;
  reset?: boolean;
};
type RecordDraft = Pick<
  RecordMutation,
  "today" | "counts" | "coverage" | "reset"
>;

function continuousMs({ previous, current }: Interval): number {
  if (!previous || previous.day !== current.day) return 0;
  if (!previous.observing || !current.observing) return 0;
  const elapsed = Math.floor(current.time - previous.time);
  return elapsed > 0 && elapsed <= 2500 ? elapsed : 0;
}

function capabilityMatches(
  interval: Interval,
  capability: Capability | undefined,
): boolean {
  if (!capability || !interval.previous) return false;
  return interval.previous.capabilities.some(
    (prior) =>
      prior.operation === capability.operation &&
      prior.revision === capability.revision,
  );
}

function observedCoverage(
  coverage: CoverageDays,
  interval: Interval,
): RecordMutation["coverage"] {
  const { current } = interval;
  const elapsed = continuousMs(interval);
  return recordOperations.map((operation) => {
    const capability = current.capabilities.find(
      (c) => c.operation === operation,
    );
    const activeMs = capabilityMatches(interval, capability) ? elapsed : 0;
    return {
      day: current.day,
      operation,
      value: {
        knowledge: activeMs > 0 ? "observed" : "not-observed",
        activeMs,
        // Positive active time already proves same-day continuity with a prior baseline.
        gap: !activeMs || !coverage[current.day]?.[operation],
        capabilityRevision: capability?.revision ?? "unverified",
      },
    };
  });
}

function historicalCoverage(
  current: RecordingBaseline,
  counts: RecordChange["counts"],
): RecordMutation["coverage"] {
  return counts
    .filter((entry) => entry.day !== current.day)
    .map((entry) => ({
      day: entry.day,
      operation: entry.operation,
      value: {
        knowledge: "not-observed",
        activeMs: 0,
        gap: true,
        capabilityRevision:
          current.capabilities.find((c) => c.operation === entry.operation)
            ?.revision ?? "unverified",
      },
    }));
}

function coverageChanged(prior: Coverage | undefined, next: Coverage): boolean {
  if (!prior || next.activeMs > 0) return true;
  if (next.gap && !prior.gap) return true;
  if (next.capabilityRevision !== prior.capabilityRevision) return true;
  return next.knowledge === "observed" && prior.knowledge !== "observed";
}

// Pure preparation: no sequence allocation, persistence or baseline mutation.
export function prepareRecordChange(
  data: Pick<StorageState, "coverage" | "highWater">,
  interval: Interval,
  change: RecordChange,
): RecordDraft | null {
  const { current } = interval;
  const coverage =
    change.reset || !current.observing
      ? []
      : observedCoverage(data.coverage, interval);
  coverage.push(...historicalCoverage(current, change.counts));
  const changed = coverage.some((row) =>
    coverageChanged(data.coverage[row.day]?.[row.operation], row.value),
  );
  if (
    !change.counts.length &&
    !change.reset &&
    current.day === data.highWater &&
    !changed
  )
    return null;
  return {
    today: current.day,
    ...(change.counts.length ? { counts: change.counts } : {}),
    coverage,
    reset: change.reset,
  };
}
