import type { ObserverCandidate, Counts, Notice, Observation, OperationId, Settings, Snapshot, SnapshotErrorKind } from '../shared/coach.ts';
import { operations } from '../shared/coach.ts';
import { classify } from './detector.ts';
import { cutoffDate, validDate } from './dates.ts';
import { SerialQueue } from './serial-queue.ts';
import { learningState, withLearningState, type LearningState } from '../shared/learning.ts';

const NOTICE_TTL_MS = 2000;
const GLOBAL_NOTICE_INTERVAL_MS = 10_000;
const OPERATION_NOTICE_INTERVAL_MS = 60_000;
const TRANSACTION_WINDOW = 4096;

export function notificationCooldownElapsed(now: number, lastNotice: number, lastOperationNotice: number): boolean {
  return now - lastNotice >= GLOBAL_NOTICE_INTERVAL_MS &&
    now - lastOperationNotice >= OPERATION_NOTICE_INTERVAL_MS;
}

export interface Repository {
  load(): Promise<{ counts: Counts; settings: Settings }>;
  saveCounts(counts: Counts): Promise<void>;
  saveSettings(settings: Settings): Promise<void>;
}
export type Dependencies = {
  repository: Repository;
  date(): string;
  now(): number;
  notify(notice: Notice): Promise<boolean>;
  changed(snapshot: Snapshot): void;
};

export class Coach {
  private dependencies: Dependencies;
  private counts: Counts = {};
  private settings: Settings = { muted: [], opened: false };
  private observing = false;
  private generation = 0;
  private sequence = 0;
  private protocol: 1 | 2 | null = null;
  private transactions = new Set<number>();
  private latestTransaction = 0;
  private notificationsPaused = false;
  private lastNotice = -Infinity;
  private lastOperation = new Map<OperationId, number>();
  private error: string | null = null;
  private observerError: string | null = null;
  private errorKind: SnapshotErrorKind | null = null;
  private pendingSave = false;
  private readonly queue = new SerialQueue();
  private pendingSettings: Settings | null = null;
  constructor(dependencies: Dependencies) { this.dependencies = dependencies; }
  deleteCounts(): Promise<void> {
    this.stop();
    return this.queue.run(async () => {
      this.counts = {};
      this.sequence = 0;
      this.pendingSave = true;
      await this.persist();
    });
  }
  async initialize(): Promise<void> {
    this.error = null;
    this.observerError = null;
    try {
      const loaded = await this.dependencies.repository.load();
      this.counts = loaded.counts;
      this.settings = loaded.settings;
      await this.refreshDate();
    } catch {
      this.error ??= '保存データを読み込めません。元のデータは保持しています。'; this.errorKind = 'storage';
      this.stop();
    }
  }
  async retrySave(): Promise<void> {
    await this.queue.run(async () => {
      if (this.errorKind === 'storage' && !this.pendingSave && !this.pendingSettings) {
        try {
          const loaded = await this.dependencies.repository.load();
          this.counts = loaded.counts; this.settings = loaded.settings; this.error = null; this.errorKind = null;
          await this.refreshDate();
        } catch { this.error = '保存データを読み込めません。元のデータは保持しています。'; this.errorKind = 'storage'; }
      }
      if (this.pendingSave) await this.persist();
      if (this.pendingSettings) {
        try {
          await this.dependencies.repository.saveSettings(this.pendingSettings);
          this.settings = this.pendingSettings;
          this.pendingSettings = null;
          if (!this.pendingSave && this.errorKind === 'settings-save') { this.error = null; this.errorKind = null; }
        } catch { this.error = '設定を保存できません。再試行してください。'; this.errorKind = 'settings-save'; }
      }
      this.dependencies.changed(this.snapshot());
    });
  }
  begin(generation: number): void {
    if (this.error || this.observerError || this.pendingSave || this.pendingSettings) return;
    this.generation = generation;
    this.sequence = 0;
    this.protocol = null;
    this.transactions.clear(); this.latestTransaction = 0;
    this.observing = true;
  }
  stop(): void {
    this.observing = false;
    this.generation++;
    this.dependencies.changed(this.snapshot());
  }
  pauseNotifications(paused: boolean): void {
    if (!this.observing) return;
    this.notificationsPaused = paused;
    this.dependencies.changed(this.snapshot());
  }
  fault(message: string): void {
    this.observerError = message;
    this.stop();
  }
  storageFault(message: string): void {
    if (!this.observing && this.errorKind === 'storage') return;
    this.error = message; this.errorKind = 'storage'; this.stop();
  }
  idle(): Promise<void> { return this.queue.run(async () => {}); }
  tick(): Promise<void> { return this.queue.run(() => this.refreshDate()); }
  setMuted(operation: OperationId, muted: boolean): Promise<void> {
    return this.setLearningState(operation, muted ? 'excluded' : 'learning');
  }
  setLearningState(operation: OperationId, state: LearningState): Promise<void> {
    return this.queue.run(async () => {
      const next = withLearningState(this.pendingSettings ?? this.settings, operation, state);
      try {
        await this.dependencies.repository.saveSettings(next);
        this.settings = next;
        this.pendingSettings = null;
        if (!this.pendingSave && this.errorKind === 'settings-save') { this.error = null; this.errorKind = null; }
      } catch {
        this.pendingSettings = next;
        this.error = '設定を保存できません。再試行してください。';
        this.errorKind = 'settings-save';
        this.stop();
      }
      this.dependencies.changed(this.snapshot());
    });
  }
  opened(): Promise<void> {
    return this.queue.run(async () => {
      if (this.settings.opened) return;
      const next = { ...(this.pendingSettings ?? this.settings), opened: true };
      try {
        await this.dependencies.repository.saveSettings(next);
        this.settings = next;
      } catch {
        this.pendingSettings = next;
        this.error = '設定を保存できません。再試行してください。';
        this.errorKind = 'settings-save';
        this.stop();
      }
    });
  }
  setNormalBounds(normalBounds: import('../shared/coach.ts').Bounds): Promise<void> {
    return this.queue.run(async () => {
      const notify = this.pendingSettings !== null;
      const next = { ...(this.pendingSettings ?? this.settings), normalBounds: { ...normalBounds } };
      try {
        await this.dependencies.repository.saveSettings(next);
        this.settings = next; this.pendingSettings = null;
        if (!this.pendingSave && this.errorKind === 'settings-save') { this.error = null; this.errorKind = null; }
      } catch {
        this.pendingSettings = next; this.error = '設定を保存できません。再試行してください。'; this.errorKind = 'settings-save'; this.stop();
      }
      if (notify || this.pendingSettings) this.dependencies.changed(this.snapshot());
    });
  }
  private async refreshDate(): Promise<void> {
    const today = this.dependencies.date();
    if (!validDate(today) || Object.keys(this.counts).some((day) => day > today)) {
      this.error = '端末の日付が記録より前です。日付を確認してください。';
      this.errorKind = 'clock';
      this.stop();
      return;
    }
    const cutoff = cutoffDate(today);
    const next = Object.fromEntries(Object.entries(this.counts).filter(([day]) => day >= cutoff));
    if (Object.keys(next).length !== Object.keys(this.counts).length) {
      this.counts = next;
      this.pendingSave = true;
      await this.persist();
    }
  }
  private async persist(): Promise<void> {
    try {
      await this.dependencies.repository.saveCounts(this.counts);
      this.pendingSave = false;
      this.error = this.pendingSettings ? '設定を保存できません。再試行してください。' : null;
      if (this.errorKind === 'record-save' || this.errorKind === 'settings-save') this.errorKind = this.pendingSettings ? 'settings-save' : null;
    } catch {
      this.pendingSave = true;
      this.error = '記録を保存できません。保存先を確認して再試行してください。';
      this.errorKind = 'record-save';
      this.stop();
    }
    this.dependencies.changed(this.snapshot());
  }
  accept(candidate: ObserverCandidate): Promise<void> {
    const receivedAt = this.dependencies.now();
    const snapshot = structuredClone(candidate);
    return this.queue.run(() => this.apply(snapshot, receivedAt));
  }
  private async apply(candidate: ObserverCandidate, receivedAt: number): Promise<void> {
    if (!Number.isInteger(candidate.sequence) || candidate.sequence < 1 || candidate.sequence > 0x7fffffff) return;
    if (!this.observing || candidate.generation !== this.generation || candidate.sequence <= this.sequence) return;
    if (this.protocol !== null && candidate.protocolVersion !== this.protocol) return;
    this.protocol = candidate.protocolVersion;
    // 除外した候補も消費し、同じ世代・sequenceを別の内容で再受理しない。
    this.sequence = candidate.sequence;
    if (candidate.protocolVersion === 2) {
      const id = candidate.transaction;
      if (!Number.isInteger(id) || id < 1 || id > 0x7fffffff || this.transactions.has(id) || id <= this.latestTransaction - TRANSACTION_WINDOW) return;
      this.latestTransaction = Math.max(this.latestTransaction, id);
      this.transactions.add(id);
      // Retired IDs remain inadmissible even after their tombstones are pruned.
      for (const seen of this.transactions) if (seen <= this.latestTransaction - TRANSACTION_WINDOW) this.transactions.delete(seen);
    }
    const observation = classify(candidate);
    if (!observation) return;
    await this.refreshDate();
    if (!this.observing || this.error) return;
    if (observation.date > this.dependencies.date() || observation.date < cutoffDate(this.dependencies.date())) return;
    const counts = structuredClone(this.counts);
    const day = counts[observation.date] ??= {};
    const entry = day[observation.operation] ??= { mouse: 0, key: 0 };
    entry[observation.origin]++;
    this.counts = counts;
    this.pendingSave = true;
    await this.persist();
    if (this.pendingSave) return;
    const now = this.dependencies.now();
    const notice = this.createNotice(observation, candidate.generation, receivedAt, now);
    if (!notice) return;
    const shown = await this.dependencies.notify(notice);
    if (shown) {
      this.lastNotice = this.dependencies.now();
      this.lastOperation.set(observation.operation, this.lastNotice);
    }
  }
  private createNotice(observation: Observation, generation: number, receivedAt: number, now: number): Notice | null {
    if (!this.observing || generation !== this.generation || this.notificationsPaused) return null;
    if (!(now - receivedAt < NOTICE_TTL_MS)) return null;
    if (learningState(this.settings, observation.operation) !== 'learning' || observation.origin !== 'mouse' ||
        !observation.monitor || !observation.shortcut) return null;
    if (!notificationCooldownElapsed(now, this.lastNotice, this.lastOperation.get(observation.operation) ?? -Infinity)) return null;
    const definition = operations.find((operation) => operation.id === observation.operation);
    if (!definition?.implemented) return null;
    return { operation: observation.operation, label: definition.label, shortcut: observation.shortcut,
      monitor: observation.monitor, expiresAt: receivedAt + NOTICE_TTL_MS };
  }
  snapshot(): Snapshot {
    return { counts: structuredClone(this.counts), settings: structuredClone(this.settings), observing: this.observing,
      notificationsPaused: this.notificationsPaused, error: this.observerError ?? this.error,
      errorKind: this.observerError ? 'observer' : this.error ? this.errorKind : null,
      pendingSave: this.pendingSave || this.pendingSettings !== null };
  }
}
