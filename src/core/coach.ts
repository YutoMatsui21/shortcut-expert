import type { Candidate, Counts, Notice, OperationId, Settings, Snapshot } from '../shared/coach.ts';
import { classify } from './detector.ts';
import { cutoffDate, validDate } from './dates.ts';

export interface Repository {
  load(): Promise<{ counts: Counts; settings: Settings }>;
  saveCounts(counts: Counts): Promise<void>;
  saveSettings(settings: Settings): Promise<void>;
}
export type Dependencies = {
  repository: Repository;
  date(): string; now(): number;
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
  private notificationsPaused = false;
  private lastNotice = -Infinity;
  private lastOperation = new Map<OperationId, number>();
  private error: string | null = null;
  private pendingSave = false;
  private work: Promise<void> = Promise.resolve();
  private pendingSettings: Settings | null = null;
  constructor(dependencies: Dependencies) { this.dependencies = dependencies; }
  deleteCounts(): Promise<void> {
    this.stop();
    return this.enqueue(async () => { this.counts = {}; this.sequence = 0; this.pendingSave = true; await this.persist(); });
  }
  async initialize(): Promise<void> {
    this.error = null;
    try {
      const loaded = await this.dependencies.repository.load();
      this.counts = loaded.counts; this.settings = loaded.settings;
      await this.refreshDate();
    } catch { this.error ??= '保存データを読み込めません。元のデータは保持しています。'; this.stop(); }
  }
  async retrySave(): Promise<void> {
    await this.enqueue(async () => {
      if (this.pendingSave) await this.persist();
      if (this.pendingSettings) {
        try {
          await this.dependencies.repository.saveSettings(this.pendingSettings);
          this.settings = this.pendingSettings; this.pendingSettings = null; this.error = null;
        } catch { this.error = '設定を保存できません。再試行してください。'; }
      }
      this.dependencies.changed(this.snapshot());
    });
  }
  begin(generation: number): void {
    if (this.error || this.pendingSave || this.pendingSettings) return;
    this.generation = generation; this.sequence = 0; this.observing = true;
  }
  stop(): void { this.observing = false; this.generation++; this.dependencies.changed(this.snapshot()); }
  pauseNotifications(paused: boolean): void { this.notificationsPaused = paused; this.dependencies.changed(this.snapshot()); }
  fault(message: string): void { this.error = message; this.stop(); }
  idle(): Promise<void> { return this.enqueue(async () => {}); }
  tick(): Promise<void> { return this.enqueue(() => this.refreshDate()); }
  setMuted(operation: OperationId, muted: boolean): Promise<void> {
    return this.enqueue(async () => {
      const next = { ...this.settings, muted: muted ? [...new Set([...this.settings.muted, operation])]
        : this.settings.muted.filter((id) => id !== operation) };
      try { await this.dependencies.repository.saveSettings(next); this.settings = next; }
      catch { this.pendingSettings = next; this.error = '設定を保存できません。再試行してください。'; this.stop(); }
      this.dependencies.changed(this.snapshot());
    });
  }
  opened(): Promise<void> {
    return this.enqueue(async () => {
      if (this.settings.opened) return;
      try { const next = { ...this.settings, opened: true }; await this.dependencies.repository.saveSettings(next); this.settings = next; }
      catch { this.error = '設定を保存できません。'; this.stop(); }
    });
  }
  private async refreshDate(): Promise<void> {
    const today = this.dependencies.date();
    if (!validDate(today) || Object.keys(this.counts).some((day) => day > today)) {
      this.error = '端末の日付が記録より前です。日付を確認してください。'; this.stop(); return;
    }
    const next = Object.fromEntries(Object.entries(this.counts).filter(([day]) => day >= cutoffDate(today)));
    if (Object.keys(next).length !== Object.keys(this.counts).length) {
      this.counts = next; this.pendingSave = true; await this.persist();
    }
  }
  private async persist(): Promise<void> {
    try { await this.dependencies.repository.saveCounts(this.counts); this.pendingSave = false;
      this.error = this.pendingSettings ? '設定を保存できません。再試行してください。' : null; }
    catch { this.pendingSave = true; this.error = '記録を保存できません。保存先を確認して再試行してください。'; this.stop(); }
    this.dependencies.changed(this.snapshot());
  }
  private enqueue(task: () => Promise<void>): Promise<void> {
    const result = this.work.then(task); this.work = result.catch(() => {}); return result;
  }
  accept(candidate: Candidate): Promise<void> {
    const receivedAt = this.dependencies.now();
    return this.enqueue(() => this.apply(candidate, receivedAt));
  }
  private async apply(candidate: Candidate, receivedAt: number): Promise<void> {
    if (!this.observing || candidate.generation !== this.generation || candidate.sequence <= this.sequence) return;
    this.sequence = candidate.sequence;
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
    this.pendingSave = true; await this.persist();
    if (this.pendingSave) return;
    const now = this.dependencies.now();
    if (this.observing && candidate.generation === this.generation && !this.notificationsPaused &&
        now - receivedAt < 2000 &&
        !this.settings.muted.includes(observation.operation) && observation.origin === 'mouse' && observation.monitor && observation.shortcut &&
        now - this.lastNotice >= 10_000 && now - (this.lastOperation.get(observation.operation) ?? -Infinity) >= 60_000) {
      const shown = await this.dependencies.notify({ operation: observation.operation, label: '最大化',
        shortcut: observation.shortcut, monitor: observation.monitor, expiresAt: receivedAt + 2000 });
      if (shown) { this.lastNotice = this.dependencies.now(); this.lastOperation.set(observation.operation, this.lastNotice); }
    }
  }
  snapshot(): Snapshot {
    return { counts: structuredClone(this.counts), settings: structuredClone(this.settings), observing: this.observing,
      notificationsPaused: this.notificationsPaused, error: this.error, pendingSave: this.pendingSave || this.pendingSettings !== null };
  }
}
