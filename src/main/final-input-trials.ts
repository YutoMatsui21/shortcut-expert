import { classifyGesture } from "../core/detector.ts";
import type {
  Snapshot,
  OperationId,
  LearningState,
  ObserverCandidate,
  ShortcutNoticeItem,
  Counts,
} from "../shared/coach.ts";
import {
  learningOperations,
  learningState,
  isLearningState,
} from "../shared/learning.ts";
import type { WindowDiagnosticCounts } from "../shared/window-diagnostics.ts";
import { finalInputCases, type FinalCase } from "./final-input-cases.ts";
import {
  finalCandidateDiagnostics,
  type FinalDiagnosticKey,
} from "./final-input-diagnostics.ts";

type Plan = {
  caseId: string;
  application: "standard" | "chrome" | "edge" | "external";
  state: LearningState;
  secondaryState: LearningState;
  paused: boolean;
  stopped: boolean;
  slot: number;
};
type Confirmation = {
  result: "matched" | "different" | "not-observed";
  notification: "matched" | "different" | "not-seen" | "not-expected";
  equivalence: "matched" | "different" | "not-tested";
};
type Deps = {
  snapshot(): Snapshot;
  start(paused: boolean): Promise<void>;
  stop(): Promise<void>;
  idle(): Promise<void>;
  configure(states: Partial<Record<OperationId, LearningState>>): Promise<void>;
  date(): string;
  now?(): number;
};
type Result = Plan & {
  trial: number;
  valid: boolean;
  completed: boolean;
  expired: boolean;
  interrupted: boolean;
  counts: Counts;
  slotMatched: boolean;
  dateChanged: boolean;
  diagnostics: Partial<Record<FinalDiagnosticKey, number>>;
  nativeDiagnostics: WindowDiagnosticCounts | null;
  recordsPassed: boolean;
  notificationRequests: number;
  notificationRequestPassed: boolean;
  notificationOperations: Partial<Record<OperationId, number>>;
  candidates: number;
  classified: Partial<Record<OperationId, number>>;
  equivalence: Confirmation["equivalence"];
  operatorResult: Confirmation["result"];
  visibleNotification: Confirmation["notification"];
};
const operationIds = Array.from(
  { length: 14 },
  (_, i) => `W${String(i + 1).padStart(2, "0")}`,
) as OperationId[];
function differences(before: Counts, after: Counts): Counts {
  const result: Counts = {};
  for (const day of new Set([...Object.keys(before), ...Object.keys(after)]))
    for (const op of operationIds) {
      const mouse =
        (after[day]?.[op]?.mouse ?? 0) - (before[day]?.[op]?.mouse ?? 0);
      const key = (after[day]?.[op]?.key ?? 0) - (before[day]?.[op]?.key ?? 0);
      if (mouse || key) (result[day] ??= {})[op] = { mouse, key };
    }
  return result;
}
function readConfirmation(value: unknown): Confirmation | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  if (
    Object.keys(c).some(
      (key) => !["result", "notification", "equivalence"].includes(key),
    ) ||
    !["matched", "different", "not-observed"].includes(String(c.result)) ||
    !["matched", "different", "not-seen", "not-expected"].includes(
      String(c.notification),
    ) ||
    !["matched", "different", "not-tested"].includes(String(c.equivalence))
  )
    return null;
  return c as Confirmation;
}

// Fixed case IDs and bounded aggregate counts only. No raw candidate, HWND, input trace or title is retained.
export class FinalInputTrials {
  readonly results: Result[] = [];
  private deps: Deps;
  private active: {
    plan: Plan;
    definition: FinalCase;
    before: Counts;
    day: string;
    expires: number;
    expired: boolean;
    interrupted: boolean;
    tracking: boolean;
    states: Partial<Record<OperationId, LearningState>>;
    requests: number;
    noticeMatch: boolean;
    notificationOperations: Partial<Record<OperationId, number>>;
    candidates: number;
    slotMatched: boolean;
    classified: Partial<Record<OperationId, number>>;
    diagnostics: Partial<Record<FinalDiagnosticKey, number>>;
    nativeDiagnostics: WindowDiagnosticCounts | null;
  } | null = null;
  constructor(deps: Deps) {
    this.deps = deps;
  }
  get armed() {
    return this.active !== null;
  }
  private now() {
    return this.deps.now?.() ?? performance.now();
  }
  expire() {
    if (this.active) this.active.expired = true;
  }
  nativeDiagnostics(counts: WindowDiagnosticCounts) {
    if (this.active && !this.active.plan.stopped)
      this.active.nativeDiagnostics = { ...counts };
  }
  candidate(value: ObserverCandidate) {
    const trial = this.active;
    if (!trial?.tracking) return;
    trial.candidates = Math.min(1000, trial.candidates + 1);
    for (const key of finalCandidateDiagnostics(value))
      trial.diagnostics[key] = Math.min(
        1000,
        (trial.diagnostics[key] ?? 0) + 1,
      );
    for (const item of classifyGesture(value)) {
      trial.classified[item.operation] = Math.min(
        1000,
        (trial.classified[item.operation] ?? 0) + 1,
      );
      if (
        item.operation === "W12" &&
        trial.definition.records.includes("W12") &&
        (value.evidence.kind !== "taskbar-input" ||
          value.evidence.slot !== trial.plan.slot)
      )
        trial.slotMatched = false;
    }
  }
  observe(snapshot: Snapshot) {
    const trial = this.active;
    if (!trial?.tracking) return;
    if (
      snapshot.observing === trial.plan.stopped ||
      snapshot.error ||
      snapshot.pendingSave ||
      Object.entries(trial.states).some(
        ([op, state]) =>
          learningState(snapshot.settings, op as OperationId) !== state,
      ) ||
      (!trial.plan.stopped &&
        snapshot.notificationsPaused !== trial.plan.paused)
    )
      trial.interrupted = true;
  }
  private expectedNotices(trial: NonNullable<FinalInputTrials["active"]>) {
    return trial.plan.paused || trial.plan.stopped
      ? []
      : trial.definition.notices
          .filter((item) => trial.states[item.operation] === "learning")
          .map((item) => ({
            operation: item.operation,
            shortcut:
              item.shortcut === "slot"
                ? `Win + ${trial.plan.slot === 10 ? 0 : trial.plan.slot}`
                : item.shortcut,
          }));
  }
  noticeRequested(
    operation: OperationId,
    shortcut = "",
    items?: ShortcutNoticeItem[],
  ) {
    const trial = this.active;
    if (!trial?.tracking) return;
    trial.requests = Math.min(1000, trial.requests + 1);
    const expected = this.expectedNotices(trial),
      actual = items ?? [{ operation, label: "", shortcut }];
    if (
      actual.length !== expected.length ||
      actual.some(
        (item, i) =>
          item.operation !== expected[i]?.operation ||
          item.shortcut !== expected[i]?.shortcut,
      )
    )
      trial.noticeMatch = false;
    for (const item of actual)
      if (operationIds.includes(item.operation))
        trial.notificationOperations[item.operation] = Math.min(
          1000,
          (trial.notificationOperations[item.operation] ?? 0) + 1,
        );
  }
  async arm(value: unknown) {
    if (
      this.active ||
      this.results.length >= 200 ||
      !value ||
      typeof value !== "object"
    )
      throw new Error("invalid-plan");
    const p = value as Record<string, unknown>;
    const definition = finalInputCases.find((c) => c.id === p.caseId);
    if (
      !definition ||
      Object.keys(p).some(
        (key) =>
          ![
            "caseId",
            "application",
            "state",
            "secondaryState",
            "paused",
            "stopped",
            "slot",
          ].includes(key),
      ) ||
      !["standard", "chrome", "edge", "external"].includes(
        String(p.application),
      ) ||
      !isLearningState(p.state) ||
      !isLearningState(p.secondaryState) ||
      typeof p.paused !== "boolean" ||
      typeof p.stopped !== "boolean" ||
      !Number.isInteger(p.slot) ||
      Number(p.slot) < 1 ||
      Number(p.slot) > 10
    )
      throw new Error("invalid-plan");
    const plan: Plan = {
      caseId: definition.id,
      application: p.application as Plan["application"],
      state: p.state,
      secondaryState: p.secondaryState,
      paused: p.paused,
      stopped: p.stopped,
      slot: Number(p.slot),
    };
    await this.deps.stop();
    await this.deps.idle();
    const states = Object.fromEntries(
      learningOperations.map((op) => [op.id, "learning"]),
    ) as Partial<Record<OperationId, LearningState>>;
    if (definition.records[0]) states[definition.records[0]] = plan.state;
    if (definition.records[1])
      states[definition.records[1]] = plan.secondaryState;
    await this.deps.configure(states);
    const snapshot = this.deps.snapshot();
    if (snapshot.error || snapshot.pendingSave || snapshot.observing)
      throw new Error("product-error");
    this.active = {
      plan,
      definition,
      before: structuredClone(snapshot.counts),
      day: this.deps.date(),
      expires: 0,
      expired: false,
      interrupted: false,
      tracking: false,
      states,
      requests: 0,
      noticeMatch: true,
      notificationOperations: {},
      candidates: 0,
      slotMatched: true,
      classified: {},
      diagnostics: {},
      nativeDiagnostics: null,
    };
    try {
      if (!plan.stopped) await this.deps.start(plan.paused);
      if (
        this.deps.snapshot().observing === plan.stopped ||
        this.deps.snapshot().error
      )
        throw new Error("observation-state");
      this.active.expires = this.now() + 45_000;
      this.active.tracking = true;
    } catch (error) {
      this.active = null;
      await this.deps.stop();
      throw error;
    }
  }
  async finish(completed: boolean, value?: unknown) {
    const trial = this.active;
    if (!trial) return;
    const confirmation = readConfirmation(value);
    trial.expired ||= this.now() >= trial.expires;
    this.observe(this.deps.snapshot());
    trial.tracking = false;
    await this.deps.stop();
    await this.deps.idle();
    const snapshot = this.deps.snapshot(),
      counts = differences(trial.before, snapshot.counts);
    const dateChanged = this.deps.date() !== trial.day;
    const slotMatched =
      trial.slotMatched &&
      (!trial.definition.records.includes("W12") ||
        trial.plan.stopped ||
        (trial.classified.W12 ?? 0) > 0);
    const valid =
      completed &&
      !!confirmation &&
      !dateChanged &&
      !trial.expired &&
      !trial.interrupted &&
      !snapshot.error &&
      !snapshot.pendingSave &&
      !snapshot.observing;
    const expected: Counts = {};
    if (!trial.plan.stopped && trial.definition.origin !== "negative")
      for (const op of trial.definition.records)
        (expected[trial.day] ??= {})[op] = {
          mouse: trial.definition.origin === "mouse" ? 1 : 0,
          key: trial.definition.origin === "key" ? 1 : 0,
        };
    const recordMatch =
      Object.keys(counts).length === Object.keys(expected).length &&
      Object.entries(expected).every(
        ([day, ops]) =>
          Object.keys(ops).length === Object.keys(counts[day] ?? {}).length &&
          Object.entries(ops).every(
            ([op, value]) =>
              value!.mouse === counts[day]?.[op as OperationId]?.mouse &&
              value!.key === counts[day]?.[op as OperationId]?.key,
          ),
      );
    this.results.push({
      trial: this.results.length + 1,
      ...trial.plan,
      valid,
      completed,
      expired: trial.expired,
      interrupted: trial.interrupted,
      counts,
      slotMatched,
      dateChanged,
      recordsPassed: valid && recordMatch && slotMatched,
      notificationRequests: trial.requests,
      notificationRequestPassed:
        valid &&
        trial.noticeMatch &&
        trial.requests === (this.expectedNotices(trial).length ? 1 : 0),
      notificationOperations: trial.notificationOperations,
      candidates: trial.candidates,
      classified: trial.classified,
      diagnostics: trial.diagnostics,
      nativeDiagnostics: trial.nativeDiagnostics,
      equivalence: confirmation?.equivalence ?? "not-tested",
      operatorResult: confirmation?.result ?? "not-observed",
      visibleNotification: confirmation?.notification ?? "not-seen",
    });
    this.active = null;
  }
}
