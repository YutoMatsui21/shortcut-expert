import type {
  ObserverCandidate,
  ShortcutNotice,
  OperationId,
  Settings,
  Snapshot,
  SnapshotErrorKind,
} from "../shared/coach.ts";
import {
  learningOperations,
  learningState,
  withLearningState,
  type LearningState,
} from "../shared/learning.ts";
import { defaultRecordsQuery, type RecordsQuery } from "../shared/records.ts";
import type {
  DurableRepository,
  RecordMutation,
  StorageState,
} from "../shared/storage.ts";
import { daysBefore, recordOperations } from "../shared/storage.ts";
import { validDate } from "./dates.ts";
import { classifyGesture } from "./detector.ts";
import { learningReadModel } from "./learning.ts";
import { recordRanges, recordsReadModel } from "./records.ts";
import { SerialQueue } from "./serial-queue.ts";

export type Capability = { operation: OperationId; revision: string };
type Dependencies = {
  repository: DurableRepository;
  session: string;
  date(): string;
  now(): number;
  capabilities(): Capability[];
  notify(value: ShortcutNotice): Promise<boolean>;
  changed(value: Snapshot): void;
};
// Single product runtime: durable SQLite storage and v2 gesture observations.
export class DurableCoach {
  private data: StorageState = {
    counts: {},
    coverage: {},
    settings: { muted: [], opened: false },
    epoch: 1,
    highWater: "",
    revision: 0,
  };
  private observing = false;
  private paused = false;
  private noticeEpoch = 0;
  private operationNoticeEpoch = new Map<OperationId, number>();
  private error: string | null = null;
  private errorKind: SnapshotErrorKind | null = null;
  private clockError: string | null = null;
  private observerError: string | null = null;
  private settingsError: string | null = null;
  private loaded = false;
  private generation = 0;
  private candidateSequence = 0;
  private transactions = new Set<number>();
  private latestTransaction = 0;
  private writeSequence = 0;
  private session: string;
  private pending: RecordMutation | null = null;
  private deleting = false;
  private pendingSettings: Settings | null = null;
  private queue = new SerialQueue();
  private baseline: {
    day: string;
    time: number;
    observing: boolean;
    capabilities: Capability[];
  } | null = null;
  private deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
    this.session = deps.session;
  }
  async initialize(): Promise<void> {
    if (this.pending || this.pendingSettings || this.deleting) return;
    this.loaded = false;
    try {
      this.data = await this.deps.repository.load(this.deps.date());
      this.loaded = true;
      this.error = null;
      this.errorKind = null;
      this.clockError = null;
      this.observerError = null;
      this.baseline = null;
      await this.tick();
    } catch {
      this.fail(
        "保存データを読み込めません。元のデータは保持しています。",
        "storage",
      );
    }
  }
  private publish(): void {
    this.deps.changed(this.snapshot());
  }
  private fail(
    message = "記録を保存できません。保存先を確認して再試行してください。",
    kind: SnapshotErrorKind = "record-save",
  ): void {
    if (kind === "clock") this.clockError = message;
    else {
      this.error = message;
      this.errorKind = kind;
    }
    this.stop();
  }
  begin(generation: number): void {
    if (
      !this.loaded ||
      this.data.settings.recordingEnabled === false ||
      this.error ||
      this.clockError ||
      this.observerError ||
      this.pending ||
      this.pendingSettings ||
      this.deleting
    )
      return;
    this.generation = generation;
    this.candidateSequence = 0;
    this.observing = true;
    this.transactions.clear();
    this.latestTransaction = 0;
    this.baseline = {
      day: this.deps.date(),
      time: this.deps.now(),
      observing: true,
      capabilities: this.deps.capabilities(),
    };
  }
  stop(): void {
    this.observing = false;
    this.generation++;
    this.baseline = null;
    this.publish();
  }
  fault(message: string): void {
    this.observerError = message;
    this.stop();
  }
  storageFault(message: string): void {
    // Repeated read-model failures must not create a publish/refetch feedback loop.
    if (!this.observing && this.errorKind === "storage") return;
    this.fail(message, "storage");
  }
  pauseNotifications(paused: boolean): void {
    if (this.observing) {
      if (paused) this.noticeEpoch++;
      this.paused = paused;
      this.publish();
    }
  }
  idle(): Promise<void> {
    return this.queue.run(async () => {});
  }
  private prepare(
    counts: NonNullable<RecordMutation["counts"]> = [],
    reset?: boolean,
  ): RecordMutation | null {
    const today = this.deps.date();
    if (
      !validDate(today) ||
      (!reset &&
        (this.data.highWater > today ||
          Object.keys(this.data.counts).some((day) => day > today) ||
          counts.some((count) => count.day > today)))
    ) {
      this.fail(
        "端末の日付が記録より前です。日付を確認してください。",
        "clock",
      );
      return null;
    }
    const time = this.deps.now(),
      prior = this.baseline;
    const current = this.deps.capabilities();
    const elapsed = prior ? Math.floor(time - prior.time) : 0;
    const continuous =
      !!prior &&
      prior.day === today &&
      prior.observing &&
      this.observing &&
      elapsed > 0 &&
      elapsed <= 2500;
    const coverage =
      reset || !this.observing
        ? []
        : recordOperations.map((operation) => {
            const capability = current.find((c) => c.operation === operation);
            const sameCapability =
              capability &&
              prior?.capabilities.some(
                (c) =>
                  c.operation === operation &&
                  c.revision === capability.revision,
              );
            const activeMs = continuous && sameCapability ? elapsed : 0;
            return {
              day: today,
              operation,
              value: {
                knowledge:
                  activeMs > 0
                    ? ("observed" as const)
                    : ("not-observed" as const),
                activeMs,
                gap:
                  !activeMs ||
                  !prior ||
                  prior.day !== today ||
                  !this.data.coverage[today]?.[operation],
                capabilityRevision: capability?.revision ?? "unverified",
              },
            };
          });
    for (const entry of counts)
      if (entry.day !== today)
        coverage.push({
          day: entry.day,
          operation: entry.operation,
          value: {
            knowledge: "not-observed",
            activeMs: 0,
            gap: true,
            capabilityRevision:
              current.find((c) => c.operation === entry.operation)?.revision ??
              "unverified",
          },
        });
    this.baseline = {
      day: today,
      time,
      observing: this.observing,
      capabilities: current,
    };
    const coverageChanged = coverage.some((row) => {
      const prior = this.data.coverage[row.day]?.[row.operation];
      return (
        !prior ||
        row.value.activeMs > 0 ||
        (row.value.gap && !prior.gap) ||
        row.value.capabilityRevision !== prior.capabilityRevision ||
        (row.value.knowledge === "observed" && prior.knowledge !== "observed")
      );
    });
    if (
      !counts.length &&
      !reset &&
      today === this.data.highWater &&
      !coverageChanged
    )
      return null;
    return {
      epoch: this.data.epoch,
      writeSession: this.session,
      sequence: ++this.writeSequence,
      today,
      ...(counts.length ? { counts } : {}),
      coverage,
      reset,
    };
  }
  private async persist(value: RecordMutation): Promise<void> {
    this.pending = value;
    try {
      await this.deps.repository.commit(value);
      // Reload only the bounded view; counts are never copied back as full-history replacements.
      const today = this.deps.date();
      this.data = {
        ...this.data,
        ...(await this.deps.repository.query(daysBefore(today, 59), today)),
        epoch: value.reset ? value.epoch + 1 : value.epoch,
        highWater: value.today,
      };
      this.pending = null;
      if (value.reset) {
        this.deleting = false;
        this.clockError = null;
      }
      if (this.errorKind === "record-save" || this.errorKind === "storage") {
        this.error = null;
        this.errorKind = null;
      }
    } catch {
      this.fail();
    }
    this.publish();
  }
  tick(): Promise<void> {
    return this.queue.run(async () => {
      if (
        this.pending ||
        this.error ||
        this.clockError ||
        this.pendingSettings ||
        this.deleting
      )
        return;
      const value = this.prepare();
      if (value) await this.persist(value);
    });
  }
  retrySave(): Promise<void> {
    return this.queue.run(async () => {
      if (this.pending || this.pendingSettings || this.errorKind === "storage")
        await this.deps.repository.reconnect();
      if (this.pending) await this.persist(this.pending);
      if (this.pendingSettings) await this.settings(this.pendingSettings);
      if (
        this.errorKind === "storage" &&
        !this.pending &&
        !this.pendingSettings
      ) {
        try {
          this.data = await this.deps.repository.load(this.deps.date());
          this.loaded = true;
          this.error = null;
          this.errorKind = null;
          this.baseline = null;
        } catch {
          this.fail(
            "保存データを読み込めません。元のデータは保持しています。",
            "storage",
          );
        }
      }
      if (this.deleting && !this.pending) {
        const value = this.prepare(undefined, true);
        if (value) await this.persist(value);
      }
      if (
        this.loaded &&
        !this.pending &&
        !this.pendingSettings &&
        !this.deleting &&
        !this.error &&
        !this.clockError
      ) {
        const value = this.prepare();
        if (value) await this.persist(value);
      }
      this.publish();
    });
  }
  private async settings(value: Settings, publish = true): Promise<void> {
    const notify = publish || this.pendingSettings !== null;
    // No write may replace unread settings or erase a load/clock/record error.
    if (!this.loaded) {
      this.publish();
      return;
    }
    try {
      await this.deps.repository.saveSettings(value);
      const today = this.deps.date();
      const records = await this.deps.repository.query(
        daysBefore(today, 59),
        today,
      );
      this.data = { ...this.data, ...records, settings: value };
      this.pendingSettings = null;
      this.settingsError = null;
    } catch {
      this.pendingSettings = value;
      this.settingsError = "設定を保存できません。再試行してください。";
      this.stop();
    }
    if (notify || this.pendingSettings) this.publish();
  }
  setLearningState(id: OperationId, state: LearningState): Promise<void> {
    // Invalidate before entering the writer queue: a save may currently be awaiting I/O.
    if (state !== "learning")
      this.operationNoticeEpoch.set(
        id,
        (this.operationNoticeEpoch.get(id) ?? 0) + 1,
      );
    return this.queue.run(() =>
      this.settings(
        withLearningState(
          this.pendingSettings ?? this.data.settings,
          id,
          state,
        ),
      ),
    );
  }
  getLearning(today: string) {
    return this.queue.run(async () => {
      // Counts, settings and revision must come from the same serialized writer state.
      return learningReadModel(this.data, this.data.settings, today);
    });
  }
  getRecordSummary(today: string, query: RecordsQuery = defaultRecordsQuery) {
    return this.queue.run(async () => {
      const records = await this.deps.repository.query(
        recordRanges(today, query.period).priorFrom,
        today,
      );
      if (records.revision !== this.data.revision)
        throw new Error("記録の版が一致しません。");
      return recordsReadModel(records, this.data.settings, today, query);
    });
  }
  opened(): Promise<void> {
    return this.queue.run(() =>
      this.settings({
        ...(this.pendingSettings ?? this.data.settings),
        opened: true,
      }),
    );
  }
  setRecordingEnabled(recordingEnabled: boolean): Promise<void> {
    if (!recordingEnabled) this.stop();
    return this.queue.run(() =>
      this.settings({
        ...(this.pendingSettings ?? this.data.settings),
        recordingEnabled,
      }),
    );
  }
  setNormalBounds(
    normalBounds: import("../shared/coach.ts").Bounds,
  ): Promise<void> {
    return this.queue.run(() =>
      this.settings(
        {
          ...(this.pendingSettings ?? this.data.settings),
          normalBounds: { ...normalBounds },
        },
        false,
      ),
    );
  }
  deleteCounts(): Promise<void> {
    this.deleting = this.loaded;
    this.stop();
    return this.queue.run(async () => {
      if (!this.loaded) return;
      // Resolve a possible committed write before advancing epoch; never discard an unknown ACK.
      if (this.pending) await this.persist(this.pending);
      if (this.pending) return;
      const value = this.prepare(undefined, true);
      if (value) await this.persist(value);
    });
  }
  accept(value: ObserverCandidate): Promise<void> {
    const candidate = structuredClone(value);
    return this.queue.run(async () => {
      if (
        !Number.isInteger(candidate.sequence) ||
        candidate.sequence < 1 ||
        candidate.sequence > 0x7fffffff
      )
        return;
      if (
        !this.observing ||
        this.error ||
        candidate.generation !== this.generation ||
        candidate.sequence <= this.candidateSequence
      )
        return;
      if (candidate.protocolVersion !== 2) return;
      this.candidateSequence = candidate.sequence;
      if (candidate.protocolVersion === 2) {
        const id = candidate.transaction;
        if (
          !Number.isInteger(id) ||
          id < 1 ||
          id > 0x7fffffff ||
          this.transactions.has(id) ||
          id <= this.latestTransaction - 4096
        )
          return;
        this.latestTransaction = Math.max(this.latestTransaction, id);
        this.transactions.add(id);
        for (const seen of this.transactions)
          if (seen <= this.latestTransaction - 4096)
            this.transactions.delete(seen);
      }
      const observations = classifyGesture(candidate);
      if (!observations.length) return;
      const epoch = this.noticeEpoch;
      const tokens = observations.map((observation) => ({
        observation,
        operationEpoch:
          this.operationNoticeEpoch.get(observation.operation) ?? 0,
        eligible:
          !this.paused &&
          observation.origin === "mouse" &&
          !!observation.shortcut &&
          learningState(this.data.settings, observation.operation) ===
            "learning",
      }));
      const counts = observations.map((o) => ({
        day: o.date,
        operation: o.operation,
        origin: o.origin,
      }));
      const value = this.prepare(counts);
      if (!value) return;
      await this.persist(value);
      if (
        epoch !== this.noticeEpoch ||
        this.error ||
        this.pending ||
        !this.observing ||
        candidate.generation !== this.generation ||
        this.paused
      )
        return;
      const items = tokens
        .filter(
          (token) =>
            token.eligible &&
            token.operationEpoch ===
              (this.operationNoticeEpoch.get(token.observation.operation) ??
                0) &&
            learningState(this.data.settings, token.observation.operation) ===
              "learning",
        )
        .map(({ observation }) => ({
          operation: observation.operation,
          label: learningOperations.find(
            (op) => op.id === observation.operation,
          )!.label,
          shortcut: observation.shortcut!,
        }));
      if (!items.length) return;
      // One consumed delivery token per gesture, including unknown OS outcomes.
      try {
        void this.deps
          .notify({ ...items[0], ...(items.length > 1 ? { items } : {}) })
          .catch(() => {});
      } catch {
        /* An unknown delivery result must never trigger an automatic resend. */
      }
    });
  }
  snapshot(): Snapshot {
    return {
      counts: structuredClone(this.data.counts),
      coverage: structuredClone(this.data.coverage),
      revision: this.data.revision,
      settings: structuredClone(this.data.settings),
      observing: this.observing,
      notificationsPaused: this.paused,
      error:
        this.observerError ??
        this.clockError ??
        this.error ??
        this.settingsError,
      errorKind: this.observerError
        ? "observer"
        : this.clockError
          ? "clock"
          : this.error
            ? this.errorKind
            : this.settingsError
              ? "settings-save"
              : null,
      canRetrySave:
        !!this.pending ||
        !!this.pendingSettings ||
        this.deleting ||
        this.errorKind === "storage",
      pendingSave: !!this.pending || !!this.pendingSettings || this.deleting,
    };
  }
}
