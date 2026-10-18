import type { Candidate, Notice, OperationId, Settings, Snapshot } from '../shared/coach.ts';
import { operations } from '../shared/coach.ts';
import type { DurableRepository, RecordMutation, StorageState } from '../shared/storage.ts';
import { daysBefore, recordOperations } from '../shared/storage.ts';
import { classify } from './detector.ts';
import { validDate } from './dates.ts';
import { SerialQueue } from './serial-queue.ts';

export type Capability = { operation: OperationId; revision: string };
type Dependencies = {
  repository: DurableRepository; session: string; date(): string; now(): number;
  capabilities(): Capability[]; notify(value: Notice): Promise<boolean>; changed(value: Snapshot): void;
};
// New-user storage path. The legacy Coach remains exclusively for unmigrated JSON users.
export class DurableCoach {
  private data: StorageState = { counts: {}, coverage: {}, settings: { muted: [], opened: false }, epoch: 1, highWater: '', revision: 0 };
  private observing = false;
  private paused = false;
  private error: string | null = null;
  private observerError: string | null = null;
  private generation = 0;
  private candidateSequence = 0;
  private writeSequence = 0;
  private session: string;
  private pending: RecordMutation | null = null;
  private pendingSettings: Settings | null = null;
  private queue = new SerialQueue();
  private baseline: { day: string; time: number; observing: boolean; capabilities: Capability[] } | null = null;
  private lastNotice = -Infinity;
  private lastOperation = new Map<OperationId, number>();
  private deps: Dependencies;
  constructor(deps: Dependencies) { this.deps = deps; this.session = deps.session; }
  async initialize(): Promise<void> {
    if (this.pending || this.pendingSettings) return;
    try {
      this.data = await this.deps.repository.load(this.deps.date());
      this.error = null; this.observerError = null; this.baseline = null;
      await this.tick();
    } catch { this.fail('保存データを読み込めません。元のデータは保持しています。'); }
  }
  private publish(): void { this.deps.changed(this.snapshot()); }
  private fail(message = '記録を保存できません。保存先を確認して再試行してください。'): void {
    this.error = message; this.stop();
  }
  begin(generation: number): void {
    if (this.error || this.observerError || this.pending || this.pendingSettings) return;
    this.generation = generation; this.candidateSequence = 0; this.observing = true;
    this.baseline = { day: this.deps.date(), time: this.deps.now(), observing: true, capabilities: this.deps.capabilities() };
  }
  stop(): void { this.observing = false; this.generation++; this.baseline = null; this.publish(); }
  fault(message: string): void { this.observerError = message; this.stop(); }
  pauseNotifications(paused: boolean): void { if (this.observing) { this.paused = paused; this.publish(); } }
  idle(): Promise<void> { return this.queue.run(async () => {}); }
  private prepare(count?: RecordMutation['count'], reset?: boolean): RecordMutation | null {
    const today = this.deps.date();
    if (!validDate(today) || this.data.highWater > today || Object.keys(this.data.counts).some(day => day > today) || (count && count.day > today)) {
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
    return { epoch: this.data.epoch, writeSession: this.session, sequence: ++this.writeSequence, today, count, coverage, reset };
  }
  private async persist(value: RecordMutation): Promise<void> {
    this.pending = value;
    try {
      await this.deps.repository.commit(value);
      // Reload only the bounded view; counts are never copied back as full-history replacements.
      this.data = { ...this.data, ...await this.deps.repository.query(daysBefore(this.deps.date(), 59), this.deps.date()),
        epoch: value.reset ? value.epoch + 1 : value.epoch, highWater: value.today };
      this.pending = null;
      this.error = this.pendingSettings ? '設定を保存できません。再試行してください。' : null;
    } catch { this.fail(); }
    this.publish();
  }
  tick(): Promise<void> {
    return this.queue.run(async () => {
      if (this.pending || this.error) return;
      const value = this.prepare(); if (value) await this.persist(value);
    });
  }
  retrySave(): Promise<void> {
    return this.queue.run(async () => {
      if (this.pending || this.pendingSettings) await this.deps.repository.reconnect();
      if (this.pending) await this.persist(this.pending);
      if (this.pendingSettings) await this.settings(this.pendingSettings);
      this.publish();
    });
  }
  private async settings(value: Settings): Promise<void> {
    try {
      await this.deps.repository.saveSettings(value); this.data.settings = value; this.pendingSettings = null;
      if (!this.pending) this.error = null;
    } catch { this.pendingSettings = value; this.fail('設定を保存できません。再試行してください。'); }
    this.publish();
  }
  setMuted(id: OperationId, muted: boolean): Promise<void> {
    return this.queue.run(() => this.settings({ ...this.data.settings, muted: muted ? [...new Set([...this.data.settings.muted, id])]
      : this.data.settings.muted.filter(value => value !== id) }));
  }
  opened(): Promise<void> { return this.queue.run(() => this.settings({ ...this.data.settings, opened: true })); }
  deleteCounts(): Promise<void> {
    this.stop();
    return this.queue.run(async () => {
      // Resolve a possible committed write before advancing epoch; never discard an unknown ACK.
      if (this.pending) await this.persist(this.pending);
      if (this.pending) return;
      const value = this.prepare(undefined, true); if (value) await this.persist(value);
    });
  }
  accept(candidate: Candidate): Promise<void> {
    const received = this.deps.now();
    return this.queue.run(async () => {
      if (!this.observing || this.error || candidate.generation !== this.generation || candidate.sequence <= this.candidateSequence) return;
      this.candidateSequence = candidate.sequence;
      const observation = classify(candidate); if (!observation) return;
      const value = this.prepare({ day: observation.date, operation: observation.operation, origin: observation.origin });
      if (!value) return;
      await this.persist(value);
      if (this.error || this.pending || !this.observing || candidate.generation !== this.generation || this.paused ||
        observation.origin !== 'mouse' || !observation.shortcut || !observation.monitor || this.data.settings.muted.includes(observation.operation)) return;
      const now = this.deps.now();
      if (now - received >= 2000 || now - this.lastNotice < 10_000 || now - (this.lastOperation.get(observation.operation) ?? -Infinity) < 60_000) return;
      const label = operations.find(op => op.id === observation.operation)!.label;
      if (await this.deps.notify({ operation: observation.operation, label, shortcut: observation.shortcut, monitor: observation.monitor, expiresAt: received + 2000 })) {
        this.lastNotice = this.deps.now(); this.lastOperation.set(observation.operation, this.lastNotice);
      }
    });
  }
  snapshot(): Snapshot {
    return { counts: structuredClone(this.data.counts), coverage: structuredClone(this.data.coverage), revision: this.data.revision,
      settings: structuredClone(this.data.settings), observing: this.observing, notificationsPaused: this.paused,
      error: this.observerError ?? this.error, pendingSave: !!this.pending || !!this.pendingSettings };
  }
}
