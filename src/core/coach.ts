import type { Candidate, Counts, Notice, Observation, OperationId, Settings, Snapshot } from '../shared/coach.ts';
import { classify } from './detector.ts';
import { cutoffDate, validDate } from './dates.ts';
import { SerialQueue } from './serial-queue.ts';

const NOTICE_TTL_MS = 2000;
const GLOBAL_NOTICE_INTERVAL_MS = 10_000;
const OPERATION_NOTICE_INTERVAL_MS = 60_000;

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
  private notificationsPaused = false;
  private lastNotice = -Infinity;
  private lastOperation = new Map<OperationId, number>();
  private error: string | null = null;
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
    try {
      const loaded = await this.dependencies.repository.load();
      this.counts = loaded.counts;
      this.settings = loaded.settings;
      await this.refreshDate();
    } catch {
      this.error ??= '保存データを読み込めません。元のデータは保持しています。';
      this.stop();
    }
  }
  async retrySave(): Promise<void> {
    await this.queue.run(async () => {
      if (this.pendingSave) await this.persist();
      if (this.pendingSettings) {
        try {
          await this.dependencies.repository.saveSettings(this.pendingSettings);
          this.settings = this.pendingSettings;
          this.pendingSettings = null;
          this.error = null;
        } catch { this.error = '設定を保存できません。再試行してください。'; }
      }
      this.dependencies.changed(this.snapshot());
    });
  }
  begin(generation: number): void {
    if (this.error || this.pendingSave || this.pendingSettings) return;
    this.generation = generation;
    this.sequence = 0;
    this.observing = true;
  }
  stop(): void {
    this.observing = false;
    this.generation++;
    this.dependencies.changed(this.snapshot());
  }
  pauseNotifications(paused: boolean): void {
    this.notificationsPaused = paused;
    this.dependencies.changed(this.snapshot());
  }
  fault(message: string): void {
    this.error = message;
    this.stop();
  }
  idle(): Promise<void> { return this.queue.run(async () => {}); }
  tick(): Promise<void> { return this.queue.run(() => this.refreshDate()); }
  setMuted(operation: OperationId, muted: boolean): Promise<void> {
    return this.queue.run(async () => {
      const next = { ...this.settings, muted: muted ? [...new Set([...this.settings.muted, operation])]
        : this.settings.muted.filter((id) => id !== operation) };
      try {
        await this.dependencies.repository.saveSettings(next);
        this.settings = next;
      } catch {
        this.pendingSettings = next;
        this.error = '設定を保存できません。再試行してください。';
        this.stop();
      }
      this.dependencies.changed(this.snapshot());
    });
  }
  opened(): Promise<void> {
    return this.queue.run(async () => {
      if (this.settings.opened) return;
      try {
        const next = { ...this.settings, opened: true };
        await this.dependencies.repository.saveSettings(next);
        this.settings = next;
      } catch {
        this.error = '設定を保存できません。';
        this.stop();
      }
    });
  }
  private async refreshDate(): Promise<void> {
    const today = this.dependencies.date();
    if (!validDate(today) || Object.keys(this.counts).some((day) => day > today)) {
      this.error = '端末の日付が記録より前です。日付を確認してください。';
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
    } catch {
      this.pendingSave = true;
      this.error = '記録を保存できません。保存先を確認して再試行してください。';
      this.stop();
    }
    this.dependencies.changed(this.snapshot());
  }
  accept(candidate: Candidate): Promise<void> {
    const receivedAt = this.dependencies.now();
    return this.queue.run(() => this.apply(candidate, receivedAt));
  }
  private async apply(candidate: Candidate, receivedAt: number): Promise<void> {
    if (!this.observing || candidate.generation !== this.generation || candidate.sequence <= this.sequence) return;
    // 除外した候補も消費し、同じ世代・sequenceを別の内容で再受理しない。
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
    if (this.settings.muted.includes(observation.operation) || observation.origin !== 'mouse' ||
        !observation.monitor || !observation.shortcut) return null;
    if (!notificationCooldownElapsed(now, this.lastNotice, this.lastOperation.get(observation.operation) ?? -Infinity)) return null;
    return { operation: observation.operation, label: '最大化', shortcut: observation.shortcut,
      monitor: observation.monitor, expiresAt: receivedAt + NOTICE_TTL_MS };
  }
  snapshot(): Snapshot {
    return { counts: structuredClone(this.counts), settings: structuredClone(this.settings), observing: this.observing,
      notificationsPaused: this.notificationsPaused, error: this.error, pendingSave: this.pendingSave || this.pendingSettings !== null };
  }
}
