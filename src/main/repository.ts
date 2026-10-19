import type { Counts, Settings } from '../shared/coach.ts';
import type { Repository } from '../core/coach.ts';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { operations } from '../shared/coach.ts';
import { validDate } from '../core/dates.ts';
import { SerialQueue } from '../core/serial-queue.ts';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function validCounter(value: unknown): value is { mouse: number; key: number } {
  if (!object(value) || !keys(value, ['mouse', 'key'])) return false;
  return ['mouse', 'key'].every((kind) => {
    const count = value[kind];
    return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
  });
}
function validDay(value: unknown): value is Counts[string] {
  return object(value) && Object.entries(value).every(([operation, counter]) =>
    operations.some((op) => op.id === operation) && validCounter(counter));
}
function validCounts(value: unknown): value is Counts {
  return object(value) && Object.entries(value).every(([date, day]) => validDate(date) && validDay(day));
}
export function countsDocument(value: unknown): Counts | null {
  if (!object(value) || !keys(value, ['schemaVersion', 'days']) || value.schemaVersion !== 1) return null;
  return validCounts(value.days) ? value.days : null;
}
export function settingsDocument(value: unknown): Settings | null {
  if (!object(value) || !keys(value, ['schemaVersion', 'muted', 'opened']) || value.schemaVersion !== 1) return null;
  const settings = { muted: value.muted, opened: value.opened };
  return validSettings(settings) ? settings : null;
}
function validSettings(value: unknown): value is Settings {
  return object(value) && keys(value, ['muted', 'opened']) && typeof value.opened === 'boolean' &&
    Array.isArray(value.muted) && value.muted.every((id) => operations.some((op) => op.id === id)) &&
    new Set(value.muted).size === value.muted.length;
}

export class JsonRepository implements Repository {
  private directory: string;
  private readonly queue = new SerialQueue();
  constructor(directory: string) { this.directory = directory; }
  async load(): Promise<{ counts: Counts; settings: Settings }> {
    const countsFile = await this.read('counts.json', { schemaVersion: 1, days: {} });
    const settingsFile = await this.read('settings.json', { schemaVersion: 1, muted: [], opened: false });
    const counts = countsDocument(countsFile);
    const settings = settingsDocument(settingsFile);
    if (!counts || !settings) throw new Error('保存データの形式が不正です。元のファイルは保持しています。');
    return { counts, settings };
  }
  async saveCounts(counts: Counts): Promise<void> {
    if (!validCounts(counts)) throw new Error('保存データの形式が不正です。');
    await this.write('counts.json', { schemaVersion: 1, days: counts });
  }
  async saveSettings(settings: Settings): Promise<void> {
    if (!validSettings(settings)) throw new Error('保存データの形式が不正です。');
    await this.write('settings.json', { schemaVersion: 1, ...settings });
  }
  private async read(name: string, fallback: unknown): Promise<unknown> {
    try { return JSON.parse(await readFile(join(this.directory, name), 'utf8')); }
    catch (error) {
      if (object(error) && error.code === 'ENOENT') return fallback;
      throw new Error('保存データを読み込めません。元のファイルは保持しています。');
    }
  }
  private write(name: string, document: unknown): Promise<void> {
    return this.queue.run(async () => {
      await mkdir(this.directory, { recursive: true });
      const temporary = join(this.directory, name + '.tmp');
      const handle = await open(temporary, 'w');
      try {
        await handle.writeFile(JSON.stringify(document), 'utf8');
        await handle.sync();
      }
      finally { await handle.close(); }
      await rename(temporary, join(this.directory, name));
    });
  }
}
