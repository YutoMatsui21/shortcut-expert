import { defaultRecordsQuery, type RecordsQuery } from '../shared/records.ts';
import type { ObserverCandidate, Notice, OperationId, Settings, Snapshot } from '../shared/coach.ts';
import { operations } from '../shared/coach.ts';
import type { DurableRepository, RecordMutation, StorageState } from '../shared/storage.ts';
import { daysBefore, recordOperations } from '../shared/storage.ts';
import { classify } from './detector.ts';
import { validDate } from './dates.ts';
import { SerialQueue } from './serial-queue.ts';
import { learningState, withLearningState, type LearningState } from '../shared/learning.ts';
import { learningReadModel } from './learning.ts';
import { recordRanges, recordsReadModel } from './records.ts';

export type Capability = { operation: OperationId; revision: string };
type Dependencies = {
  repository: DurableRepository; session: string; date(): string; now(): number;
  capabilities(): Capability[]; notify(value: Notice): Promise<boolean>; changed(value: Snapshot): void;
};
// Durable path for new and migrated users; legacy Coach is retained for isolated regression fixtures.
export class DurableCoach {
  private data: StorageState = { counts: {}, coverage: {}, settings: { muted: [], opened: false }, epoch: 1, highWater: '', revision: 0 };
  private observing = false;
  private paused = false;
  private error: string | null = null;
  private observerError: string | null = null;
  private settingsError: string | null = null;
  private loaded = false;
  private generation = 0;
  private candidateSequence = 0;
  private protocol: 1 | 2 | null = null;
  private transactions = new Set<number>();
  private latestTransaction = 0;
  private writeSequence = 0;
  private session: string;
  private pending: RecordMutation | null = null;
  private deleting = false;
  private pendingSettings: Settings | null = null;
  private queue = new SerialQueue();
  private baseline: { day: string; time: number; observing: boolean; capabilities: Capability[] } | null = null;
  private deps: Dependencies;
  constructor(deps: Dependencies) { this.deps = deps; this.session = deps.session; }
  async initialize(): Promise<void> {
    if (this.pending || this.pendingSettings || this.deleting) return;
    this.loaded = false;
    try {
      this.data = await this.deps.repository.load(this.deps.date());
      this.loaded = true;
      this.error = null; this.observerError = null; this.baseline = null;
      await this.tick();
    } catch { this.fail('保存データを読み込めません。元のデータは保持しています。'); }
  }
  private publish(): void { this.deps.changed(this.snapshot()); }
  private fail(message = '記録を保存できません。保存先を確認して再試行してください。'): void {
    this.error = message; this.stop();
  }
  begin(generation: number): void {
    if (!this.loaded || this.error || this.observerError || this.pending || this.pendingSettings || this.deleting) return;
    this.generation = generation; this.candidateSequence = 0; this.observing = true;
    this.protocol = null; this.transactions.clear(); this.latestTransaction = 0;
    this.baseline = { day: this.deps.date(), time: this.deps.now(), observing: true, capabilities: this.deps.capabilities() };
  }
  stop(): void { this.observing = false; this.generation++; this.baseline = null; this.publish(); }
  fault(message: string): void { this.observerError = message; this.stop(); }
  pauseNotifications(paused: boolean): void { if (this.observing) { this.paused = paused; this.publish(); } }
  idle(): Promise<void> { return this.queue.run(async () => {}); }
  private prepare(count?: RecordMutation['count'], reset?: boolean): RecordMutation | null {
    const today = this.deps.date();
    if (!validDate(today) || (!reset && (this.data.highWater > today || Object.keys(this.data.counts).some(day => day > today) || (count && count.day > today)))) {
      this.fail('端末の日付が記録より前です。日付を確認してください。'); return null;
    }
    const time = this.deps.now(), prior = this.baseline;
    const current = this.deps.capabilities();
    const elapsed = prior ? Math.floor(time - prior.time) : 0;
    const continuous = !!prior && prior.day === today && prior.observing && this.observing && elapsed > 0 && elapsed <= 2500;
    const coverage = reset || !this.observing ? [] : recordOperations.map(operation => {
      const capability = current.find(c => c.operation === operation);
      const sameCapability = capability && prior?.capabilities.some(c => c.operation === operation && c.revision === capability.revision);
      const activeMs = continuous && sameCapability ? elapsed : 0;
      return { day: today, operation, value: { knowledge: activeMs > 0 ? 'observed' as const : 'not-observed' as const,
        activeMs, gap: !activeMs || !prior || prior.day !== today || !this.data.coverage[today]?.[operation], capabilityRevision: capability?.revision ?? 'unverified' } };
    });
    if (count && count.day !== today) coverage.push({ day: count.day, operation: count.operation,
      value: { knowledge: 'not-observed', activeMs: 0, gap: true,
        capabilityRevision: current.find(c => c.operation === count.operation)?.revision ?? 'unverified' } });
    this.baseline = { day: today, time, observing: this.observing, capabilities: current };
    const coverageChanged = coverage.some(row => {
      const prior = this.data.coverage[row.day]?.[row.operation];
      return !prior || row.value.activeMs > 0 || (row.value.gap && !prior.gap) ||
        row.value.capabilityRevision !== prior.capabilityRevision || (row.value.knowledge === 'observed' && prior.knowledge !== 'observed');
    });
    if (!count && !reset && today === this.data.highWater && !coverageChanged) return null;
    return { epoch: this.data.epoch, writeSession: this.session, sequence: ++this.writeSequence, today, count, coverage, reset };
  }
  private async persist(value: RecordMutation): Promise<void> {
    this.pending = value;
    try {
      await this.deps.repository.commit(value);
      // Reload only the bounded view; counts are never copied back as full-history replacements.
      const today = this.deps.date();
      this.data = { ...this.data, ...await this.deps.repository.query(daysBefore(today, 59), today),
        epoch: value.reset ? value.epoch + 1 : value.epoch, highWater: value.today };
      this.pending = null;
      if (value.reset) this.deleting = false;
      this.error = null;
    } catch { this.fail(); }
    this.publish();
  }
  tick(): Promise<void> {
    return this.queue.run(async () => {
      if (this.pending || this.error || this.pendingSettings || this.deleting) return;
      const value = this.prepare(); if (value) await this.persist(value);
    });
  }
  retrySave(): Promise<void> {
    return this.queue.run(async () => {
      if (this.pending || this.pendingSettings) await this.deps.repository.reconnect();
      if (this.pending) await this.persist(this.pending);
      if (this.pendingSettings) await this.settings(this.pendingSettings);
      if (this.deleting && !this.pending) {
        const value = this.prepare(undefined, true); if (value) await this.persist(value);
      }
      this.publish();
    });
  }
  private async settings(value: Settings, publish = true): Promise<void> {
    const notify = publish || this.pendingSettings !== null;
    // No write may replace unread settings or erase a load/clock/record error.
    if (!this.loaded) { this.publish(); return; }
    try {
      await this.deps.repository.saveSettings(value);
      const today = this.deps.date();
      const records = await this.deps.repository.query(daysBefore(today, 59), today);
      this.data = { ...this.data, ...records, settings: value }; this.pendingSettings = null;
      this.settingsError = null;
    } catch { this.pendingSettings = value; this.settingsError = '設定を保存できません。再試行してください。'; this.stop(); }
    if (notify || this.pendingSettings) this.publish();
  }
  setMuted(id: OperationId, muted: boolean): Promise<void> {
    return this.setLearningState(id, muted ? 'excluded' : 'learning');
  }
  setLearningState(id: OperationId, state: LearningState): Promise<void> {
    return this.queue.run(() => this.settings(withLearningState(this.pendingSettings ?? this.data.settings, id, state)));
  }
  getLearning(today: string) {
    return this.queue.run(async () => {
      // Counts, settings and revision must come from the same serialized writer state.
      return learningReadModel(this.data, this.data.settings, today);
    });
  }
  getRecordSummary(today: string, query: RecordsQuery = defaultRecordsQuery) {
    return this.queue.run(async () => {
      const records = await this.deps.repository.query(recordRanges(today, query.period).priorFrom, today);
      if (records.revision !== this.data.revision) throw new Error('記録の版が一致しません。');
      return recordsReadModel(records, this.data.settings, today, query);
    });
  }
  opened(): Promise<void> { return this.queue.run(() => this.settings({ ...(this.pendingSettings ?? this.data.settings), opened: true })); }
  setNormalBounds(normalBounds: import('../shared/coach.ts').Bounds): Promise<void> {
    return this.queue.run(() => this.settings({ ...(this.pendingSettings ?? this.data.settings), normalBounds: { ...normalBounds } }, false));
  }
  deleteCounts(): Promise<void> {
    this.deleting = this.loaded;
    this.stop();
    return this.queue.run(async () => {
      if (!this.loaded) return;
      // Resolve a possible committed write before advancing epoch; never discard an unknown ACK.
      if (this.pending) await this.persist(this.pending);
      if (this.pending) return;
      const value = this.prepare(undefined, true); if (value) await this.persist(value);
    });
  }
  accept(value: ObserverCandidate): Promise<void> {
    const candidate = structuredClone(value);
    return this.queue.run(async () => {
      if (!Number.isInteger(candidate.sequence) || candidate.sequence < 1 || candidate.sequence > 0x7fffffff) return;
      if (!this.observing || this.error || candidate.generation !== this.generation || candidate.sequence <= this.candidateSequence) return;
      if (this.protocol !== null && candidate.protocolVersion !== this.protocol) return;
      this.protocol = candidate.protocolVersion;
      this.candidateSequence = candidate.sequence;
      if (candidate.protocolVersion === 2) {
        const id = candidate.transaction;
        if (!Number.isInteger(id) || id < 1 || id > 0x7fffffff || this.transactions.has(id) || id <= this.latestTransaction - 4096) return;
        this.latestTransaction = Math.max(this.latestTransaction, id); this.transactions.add(id);
        for (const seen of this.transactions) if (seen <= this.latestTransaction - 4096) this.transactions.delete(seen);
      }
      const observation = classify(candidate); if (!observation) return;
      const value = this.prepare({ day: observation.date, operation: observation.operation, origin: observation.origin });
      if (!value) return;
      await this.persist(value);
      if (this.error || this.pending || !this.observing || candidate.generation !== this.generation || this.paused ||
        observation.origin !== 'mouse' || !observation.shortcut || !observation.monitor || learningState(this.data.settings, observation.operation) !== 'learning') return;
      const label = operations.find(op => op.id === observation.operation)!.label;
      // The legacy window adapter still owns its display policy until #26. Core requests every eligible notice.
      try { await this.deps.notify({ operation: observation.operation, label, shortcut: observation.shortcut, monitor: observation.monitor, expiresAt: Infinity }); }
      catch { /* An unknown delivery result must never trigger an automatic resend. */ }
    });
  }
  snapshot(): Snapshot {
    return { counts: structuredClone(this.data.counts), coverage: structuredClone(this.data.coverage), revision: this.data.revision,
      settings: structuredClone(this.data.settings), observing: this.observing, notificationsPaused: this.paused,
      error: this.observerError ?? this.error ?? this.settingsError, pendingSave: !!this.pending || !!this.pendingSettings || this.deleting };
  }
}
