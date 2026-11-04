import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type {
  Snapshot,
  LearningState,
  OperationId,
  ObserverCandidate,
  ShortcutNoticeItem,
} from "../shared/coach.ts";
import { classify } from "../core/detector.ts";
import { learningState } from "../shared/learning.ts";
import type { WindowDiagnosticCounts } from "../shared/window-diagnostics.ts";

type Plan = {
  kind: "mouse" | "key" | "negative";
  application: "standard" | "chrome";
  state: LearningState;
  paused: boolean;
  slot?: number;
  scenario?: string;
};
type NaturalOperation = "W01" | "W08" | "W12";
const switchScenarios = [
  "direct",
  "alt-tab",
  "multi-tab",
  "escape",
  "return",
  "same-window",
  "program",
  "taskbar-click",
  "win-digit",
  "switcher-mouse",
  "owner",
  "edge-tab",
];
type Deps = {
  snapshot(): Snapshot;
  start(paused: boolean): Promise<void>;
  stop(): Promise<void>;
  idle(): Promise<void>;
  configure(state: LearningState): Promise<void>;
  now?(): number;
};
const total = (snapshot: Snapshot, operation: NaturalOperation) =>
  Object.values(snapshot.counts).reduce(
    (sum, day) => ({
      mouse: sum.mouse + (day[operation]?.mouse ?? 0),
      key: sum.key + (day[operation]?.key ?? 0),
    }),
    { mouse: 0, key: 0 },
  );
export class NaturalInputTrials {
  private active: {
    plan: Plan;
    before: ReturnType<typeof total>;
    requests: number;
    wrongShortcut: boolean;
    wrongSlot: boolean;
    beforeW01: number;
    tracking: boolean;
    beforeW12: ReturnType<typeof total>;
    interrupted: boolean;
    expired: boolean;
    expires: number;
  } | null = null;
  readonly results: object[] = [];
  get armed() {
    return this.active !== null;
  }
  private deps: Deps;
  private operation: NaturalOperation;
  constructor(deps: Deps, operation: NaturalOperation = "W08") {
    this.deps = deps;
    this.operation = operation;
  }
  noticeRequested(operation: OperationId, shortcut?: string) {
    if (operation === this.operation && this.active) {
      this.active.requests++;
      if (
        this.operation === "W12" &&
        shortcut !==
          `Win + ${this.active.plan.slot === 10 ? 0 : this.active.plan.slot}`
      )
        this.active.wrongShortcut = true;
      if (this.operation === "W01" && shortcut !== "Alt + Tab")
        this.active.wrongShortcut = true;
    }
  }
  candidate(value: ObserverCandidate) {
    if (
      this.operation === "W12" &&
      this.active &&
      value.protocolVersion === 2 &&
      value.evidence.kind === "taskbar-input" &&
      classify(value) &&
      value.evidence.slot !== this.active.plan.slot
    )
      this.active.wrongSlot = true;
  }
  observe(snapshot: Snapshot) {
    if (
      this.active?.tracking &&
      (!snapshot.observing || snapshot.error || snapshot.pendingSave)
    )
      this.active.interrupted = true;
  }
  expire() {
    if (this.active) this.active.expired = true;
  }
  private now() {
    return this.deps.now?.() ?? performance.now();
  }
  async arm(value: unknown) {
    if (this.active || typeof value !== "object" || !value)
      throw new Error("invalid-plan");
    const p = value as Record<string, unknown>;
    if (
      typeof p.kind !== "string" ||
      !["mouse", "key", "negative"].includes(p.kind) ||
      typeof p.application !== "string" ||
      !["standard", "chrome"].includes(p.application) ||
      typeof p.state !== "string" ||
      !["learning", "mastered", "excluded"].includes(p.state) ||
      typeof p.paused !== "boolean"
    )
      throw new Error("invalid-plan");
    if (
      this.operation === "W12" &&
      (!Number.isInteger(p.slot) ||
        (p.kind === "negative"
          ? p.slot !== 0
          : Number(p.slot) < 1 || Number(p.slot) > 10))
    )
      throw new Error("invalid-slot");
    if (
      this.operation === "W01" &&
      (typeof p.scenario !== "string" ||
        !switchScenarios.includes(p.scenario) ||
        (p.kind === "mouse"
          ? p.scenario !== "direct"
          : p.kind === "key"
            ? !["alt-tab", "multi-tab"].includes(p.scenario)
            : ["direct", "alt-tab", "multi-tab"].includes(p.scenario)))
    )
      throw new Error("invalid-scenario");
    await this.deps.stop();
    await this.deps.idle();
    await this.deps.configure(p.state as LearningState);
    if (this.deps.snapshot().error || this.deps.snapshot().pendingSave)
      throw new Error("product-error");
    this.active = {
      plan: {
        kind: p.kind as Plan["kind"],
        application: p.application as Plan["application"],
        state: p.state as LearningState,
        paused: p.paused,
        ...(this.operation === "W12" ? { slot: Number(p.slot) } : {}),
        ...(this.operation === "W01" ? { scenario: p.scenario as string } : {}),
      },
      before: total(this.deps.snapshot(), this.operation),
      requests: 0,
      beforeW12: total(this.deps.snapshot(), "W12"),
      wrongShortcut: false,
      wrongSlot: false,
      beforeW01: Object.values(this.deps.snapshot().counts).reduce(
        (sum, day) => sum + (day.W01?.mouse ?? 0) + (day.W01?.key ?? 0),
        0,
      ),
      tracking: false,
      interrupted: false,
      expired: false,
      expires: 0,
    };
    try {
      await this.deps.start(p.paused);
      if (!this.deps.snapshot().observing || this.deps.snapshot().error)
        throw new Error("observation-not-started");
      this.active.tracking = true;
      this.active.expires = this.now() + 45_000;
    } catch (error) {
      this.active = null;
      await this.deps.stop();
      throw error;
    }
  }
  async finish(completed: boolean) {
    const trial = this.active;
    if (!trial) return;
    trial.expired ||= this.now() >= trial.expires;
    trial.tracking = false;
    await this.deps.stop();
    await this.deps.idle();
    const snapshot = this.deps.snapshot(),
      after = total(snapshot, this.operation);
    this.active = null;
    const counts = {
      mouse: after.mouse - trial.before.mouse,
      key: after.key - trial.before.key,
    };
    const expectedRequests =
      trial.plan.kind === "mouse" &&
      trial.plan.state === "learning" &&
      !trial.plan.paused
        ? 1
        : 0;
    const valid =
      completed &&
      !trial.expired &&
      !trial.interrupted &&
      !snapshot.error &&
      !snapshot.pendingSave &&
      !snapshot.observing &&
      learningState(snapshot.settings, this.operation) === trial.plan.state &&
      snapshot.notificationsPaused === trial.plan.paused;
    const detectorPassed =
      valid &&
      counts.mouse === (trial.plan.kind === "mouse" ? 1 : 0) &&
      counts.key === (trial.plan.kind === "key" ? 1 : 0);
    const w12 = total(snapshot, "W12");
    const w12Counts = {
      mouse: w12.mouse - trial.beforeW12.mouse,
      key: w12.key - trial.beforeW12.key,
    };
    this.results.push({
      trial: this.results.length + 1,
      ...trial.plan,
      completed,
      valid,
      interrupted: trial.interrupted,
      expired: trial.expired,
      counts,
      notificationRequests: trial.requests,
      detectorPassed,
      notificationRequestPassed:
        valid && !trial.wrongShortcut && trial.requests === expectedRequests,
      ...(this.operation === "W01"
        ? {
            w12Counts,
            coexistencePassed:
              valid &&
              w12Counts.mouse ===
                (trial.plan.scenario === "taskbar-click" ? 1 : 0) &&
              w12Counts.key === (trial.plan.scenario === "win-digit" ? 1 : 0),
          }
        : {}),
      ...(this.operation === "W12"
        ? {
            wrongShortcut: trial.wrongShortcut,
            slotMatched: !trial.wrongSlot,
            w01Delta:
              Object.values(snapshot.counts).reduce(
                (sum, day) => sum + (day.W01?.mouse ?? 0) + (day.W01?.key ?? 0),
                0,
              ) - trial.beforeW01,
          }
        : {}),
    });
  }
}

// Opt-in operator control only. Normal execution never reads these files or collects trial results.
export function runNaturalInputAcceptance(
  directory: string,
  deps: Deps,
  quit: () => Promise<void>,
  operation: NaturalOperation = "W08",
) {
  return runTrialControl(
    directory,
    deps,
    quit,
    operation,
    (start) => new NaturalInputTrials({ ...deps, start }, operation),
    operation === "W01",
  );
}

type ManualTrials = Omit<
  Pick<
    NaturalInputTrials,
    "armed" | "results" | "candidate" | "observe" | "expire" | "arm"
  >,
  "results"
> & {
  readonly results: object[];
  finish(completed: boolean, confirmation?: unknown): Promise<void>;
  noticeRequested(
    operation: OperationId,
    shortcut?: string,
    items?: ShortcutNoticeItem[],
  ): void;
  nativeDiagnostics?(counts: WindowDiagnosticCounts): void;
};
export function runTrialControl(
  directory: string,
  deps: Pick<Deps, "start" | "stop">,
  quit: () => Promise<void>,
  name: string,
  create: (start: Deps["start"]) => ManualTrials,
  countdown = false,
) {
  let sequence = 0,
    busy = false,
    expired = false;
  const trials = create(async (paused) => {
    if (countdown) {
      // Source selection happens with hooks OFF. The tool-window panel itself is ineligible for W01.
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const latest = JSON.parse(
        await readFile(join(directory, "control.json"), "utf8"),
      );
      if (expired || latest.sequence !== sequence || latest.action !== "arm")
        throw new Error("arming-cancelled");
    }
    await deps.start(paused);
  });
  let deadline: NodeJS.Timeout | undefined;
  let trialRetry: NodeJS.Timeout | undefined,
    shutdownRetry: NodeJS.Timeout | undefined;
  const status = async (error = false) => {
    const text = JSON.stringify({
      sequence,
      state: trials.armed ? "ARMED" : expired ? "CLOSED" : "IDLE",
      error,
      results: trials.results,
      visibleNotification:
        "unverified; API requests are not visible OS delivery",
    });
    await writeFile(join(directory, "status.tmp"), text);
    await rename(join(directory, "status.tmp"), join(directory, "status.json"));
  };
  const finish = async (completed: boolean, confirmation?: unknown) => {
    clearTimeout(deadline);
    clearTimeout(trialRetry);
    await trials.finish(completed, confirmation);
    await status();
  };
  const timer = setInterval(async () => {
    if (busy || expired) return;
    busy = true;
    try {
      let raw: string;
      try {
        raw = await readFile(join(directory, "control.json"), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      if (raw.length > 2048) throw new Error("invalid-control");
      const request = JSON.parse(raw);
      if (
        !Number.isSafeInteger(request.sequence) ||
        request.sequence <= sequence
      )
        return;
      sequence = request.sequence;
      if (request.action === "arm") {
        await trials.arm(request.plan);
        deadline = setTimeout(() => {
          trials.expire();
          void deps.stop().catch(() => {});
          void queueFinish();
        }, 45_000);
        await status();
      } else if (request.action === "finish" || request.action === "cancel")
        await finish(request.action === "finish", request.confirmation);
      else if (request.action === "end") {
        await finish(false);
        expired = true;
        await status();
        await quit();
      } else throw new Error("invalid-action");
    } catch {
      await deps.stop();
      await trials.finish(false);
      await status(true);
    } finally {
      busy = false;
    }
  }, 150);
  async function queueFinish(end = false) {
    if (busy) {
      if (end)
        shutdownRetry = setTimeout(() => {
          void queueFinish(true);
        }, 100);
      else
        trialRetry = setTimeout(() => {
          void queueFinish(false);
        }, 100);
      return;
    }
    busy = true;
    try {
      await finish(false);
      if (end) await quit();
    } finally {
      busy = false;
    }
  }
  const sessionDeadline = setTimeout(() => {
    expired = true;
    trials.expire();
    clearInterval(timer);
    clearTimeout(deadline);
    void deps.stop().catch(() => {});
    void queueFinish(true);
  }, 20 * 60_000);
  void status();
  console.log(
    name +
      "_NATURAL_READY observation stopped; arm in operator panel; 45s trial deadline",
  );
  return {
    candidate: (value: ObserverCandidate) => trials.candidate(value),
    observe: (snapshot: Snapshot) => trials.observe(snapshot),
    noticeRequested: (
      operation: OperationId,
      shortcut?: string,
      items?: ShortcutNoticeItem[],
    ) => trials.noticeRequested(operation, shortcut, items),
    nativeDiagnostics: (counts: WindowDiagnosticCounts) =>
      trials.nativeDiagnostics?.(counts),
    dispose: () => {
      clearInterval(timer);
      clearTimeout(deadline);
      clearTimeout(trialRetry);
      clearTimeout(shutdownRetry);
      clearTimeout(sessionDeadline);
    },
  };
}
