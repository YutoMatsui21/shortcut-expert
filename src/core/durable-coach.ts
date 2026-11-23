import type {
  ObserverCandidate,
  ShortcutNotice,
  OperationId,
  Settings,
  Snapshot,
  SnapshotErrorKind,
} from "../shared/coach.ts";
import { withLearningState, type LearningState } from "../shared/learning.ts";
import { defaultRecordsQuery, type RecordsQuery } from "../shared/records.ts";
import type {
  DurableRepository,
  RecordMutation,
  StorageState,
} from "../shared/storage.ts";
import { daysBefore } from "../shared/storage.ts";
import { validDate } from "./dates.ts";
import { classifyGesture } from "./detector.ts";
import { GestureNotices } from "./gesture-notices.ts";
import { learningReadModel } from "./learning.ts";
import {
  prepareRecordChange,
  type Capability,
  type RecordingBaseline,
} from "./record-preparation.ts";
import { recordRanges, recordsReadModel } from "./records.ts";
import { SerialQueue } from "./serial-queue.ts";
export type { Capability } from "./record-preparation.ts";
type Dependencies = {
  repository: DurableRepository;
  session: string;
  date(): string;
  now(): number;
  capabilities(): Capability[];
  notify(value: ShortcutNotice): Promise<boolean>;
  changed(value: Snapshot): void;
};

function validCandidateId(id: number): boolean {
  return Number.isInteger(id) && id >= 1 && id <= 0x7fffffff;
}

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
  private notices = new GestureNotices();
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
  private baseline: RecordingBaseline | null = null;
  private deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
    this.session = deps.session;
  }
  async initialize(): Promise<void> {
    if (this.hasPendingSave()) return;
    this.loaded = false;
    try {
      this.applyLoaded(await this.deps.repository.load(this.deps.date()));
      this.clockError = null;
      this.observerError = null;
      await this.tick();
    } catch {
      this.failLoad();
    }
  }
  private applyLoaded(data: StorageState): void {
    this.data = data;
    this.loaded = true;
    this.error = null;
    this.errorKind = null;
    this.baseline = null;
  }
  private failLoad(): void {
    this.fail(
      "保存データを読み込めません。元のデータは保持しています。",
      "storage",
    );
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
      !this.canSaveRecords() ||
      this.data.settings.recordingEnabled === false ||
      this.observerError
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
      if (paused) this.notices.invalidate();
      this.paused = paused;
      this.publish();
    }
  }
  idle(): Promise<void> {
    return this.queue.run(async () => {});
  }
  private canWriteDate(
    today: string,
    counts: NonNullable<RecordMutation["counts"]>,
    reset = false,
  ): boolean {
    if (!validDate(today)) return false;
    if (reset) return true;
    return (
      this.data.highWater <= today &&
      !Object.keys(this.data.counts).some((day) => day > today) &&
      !counts.some((count) => count.day > today)
    );
  }
  private prepare(
    counts: NonNullable<RecordMutation["counts"]> = [],
    reset?: boolean,
  ): RecordMutation | null {
    const today = this.deps.date();
    if (!this.canWriteDate(today, counts, reset)) {
      this.fail(
        "端末の日付が記録より前です。日付を確認してください。",
        "clock",
      );
      return null;
    }
    const current: RecordingBaseline = {
      day: today,
      time: this.deps.now(),
      observing: this.observing,
      capabilities: this.deps.capabilities(),
    };
    const draft = prepareRecordChange(
      this.data,
      { previous: this.baseline, current },
      { counts, reset },
    );
    this.baseline = current;
    if (!draft) return null;
    return {
      epoch: this.data.epoch,
      writeSession: this.session,
      sequence: ++this.writeSequence,
      ...draft,
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
      const value = this.prepareCoverage();
      if (value) await this.persist(value);
    });
  }
  private hasPendingWrite(): boolean {
    return this.pending !== null || this.pendingSettings !== null;
  }
  private hasPendingSave(): boolean {
    return this.hasPendingWrite() || this.deleting;
  }
  private recordWritesBlocked(): boolean {
    return this.hasPendingSave() || !!this.error || !!this.clockError;
  }
  private canSaveRecords(): boolean {
    return this.loaded && !this.recordWritesBlocked();
  }
  private prepareCoverage(): RecordMutation | null {
    return this.recordWritesBlocked() ? null : this.prepare();
  }
  private needsStorageReload(): boolean {
    return this.errorKind === "storage" && !this.hasPendingWrite();
  }
  private prepareReset(): RecordMutation | null {
    return this.pending ? null : this.prepare(undefined, true);
  }
  retrySave(): Promise<void> {
    return this.queue.run(async () => {
      if (this.hasPendingWrite() || this.errorKind === "storage")
        await this.deps.repository.reconnect();
      if (this.pending) await this.persist(this.pending);
      if (this.pendingSettings) await this.settings(this.pendingSettings);
      if (this.needsStorageReload()) {
        try {
          this.applyLoaded(await this.deps.repository.load(this.deps.date()));
        } catch {
          this.failLoad();
        }
      }
      const reset = this.deleting ? this.prepareReset() : null;
      if (reset) await this.persist(reset);
      const coverage = this.loaded ? this.prepareCoverage() : null;
      if (coverage) await this.persist(coverage);
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
    if (state !== "learning") this.notices.invalidateOperation(id);
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
      const value = this.prepareReset();
      if (value) await this.persist(value);
    });
  }
  private isCurrentGeneration(generation: number): boolean {
    return this.observing && generation === this.generation && !this.error;
  }
  private acceptCandidate(candidate: ObserverCandidate): boolean {
    if (!this.isCurrentGeneration(candidate.generation)) return false;
    if (!validCandidateId(candidate.sequence)) return false;
    if (candidate.sequence <= this.candidateSequence) return false;
    if (candidate.protocolVersion !== 2) return false;
    this.candidateSequence = candidate.sequence;
    return this.acceptTransaction(candidate.transaction);
  }
  private acceptTransaction(id: number): boolean {
    if (!validCandidateId(id) || this.transactions.has(id)) return false;
    if (id <= this.latestTransaction - 4096) return false;
    this.latestTransaction = Math.max(this.latestTransaction, id);
    this.transactions.add(id);
    for (const seen of this.transactions) {
      if (seen <= this.latestTransaction - 4096) this.transactions.delete(seen);
    }
    return true;
  }
  accept(value: ObserverCandidate): Promise<void> {
    const candidate = structuredClone(value);
    return this.queue.run(async () => {
      if (!this.acceptCandidate(candidate)) return;
      const observations = classifyGesture(candidate);
      if (!observations.length) return;
      const notice = this.notices.prepare(
        observations,
        this.data.settings,
        this.paused,
      );
      const counts = observations.map(({ date, operation, origin }) => ({
        day: date,
        operation,
        origin,
      }));
      const mutation = this.prepare(counts);
      if (!mutation) return;
      await this.persist(mutation);
      if (!this.isCurrentGeneration(candidate.generation)) return;
      if (this.pending || this.paused) return;
      this.notices.deliver(notice, this.data.settings, this.deps);
    });
  }
  private snapshotErrorKind(): SnapshotErrorKind | null {
    if (this.observerError) return "observer";
    if (this.clockError) return "clock";
    if (this.error) return this.errorKind;
    return this.settingsError ? "settings-save" : null;
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
      errorKind: this.snapshotErrorKind(),
      canRetrySave: this.hasPendingSave() || this.errorKind === "storage",
      pendingSave: this.hasPendingSave(),
    };
  }
}
