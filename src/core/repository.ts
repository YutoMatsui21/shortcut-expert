import type { Counts, Settings } from '../shared/coach.ts';
import type { Repository } from './coach.ts';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { operations } from '../shared/coach.ts';
import { validDate } from './dates.ts';

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(value).every((key) => allowed.includes(key)); }
function validCounts(value: unknown): value is Counts {
  return object(value) && Object.entries(value).every(([date, day]) => validDate(date) && object(day) &&
    Object.entries(day).every(([operation, counts]) => operations.some((op) => op.id === operation) && object(counts) &&
      keys(counts, ['mouse', 'key']) && ['mouse', 'key'].every((kind) =>
        typeof counts[kind] === 'number' && Number.isSafeInteger(counts[kind]) && counts[kind] >= 0)));
}
function validSettings(value: unknown): value is Settings {
  return object(value) && keys(value, ['muted', 'opened']) && typeof value.opened === 'boolean' &&
    Array.isArray(value.muted) && value.muted.every((id) => operations.some((op) => op.id === id)) &&
    new Set(value.muted).size === value.muted.length;
}

export class JsonRepository implements Repository {
  private directory: string;
  private work: Promise<void> = Promise.resolve();
  constructor(directory: string) { this.directory = directory; }
  async load(): Promise<{ counts: Counts; settings: Settings }> {
    const counts = await this.read('counts.json', { schemaVersion: 1, days: {} });
    const settings = await this.read('settings.json', { schemaVersion: 1, muted: [], opened: false });
    if (!object(counts) || !keys(counts, ['schemaVersion', 'days']) || counts.schemaVersion !== 1 || !validCounts(counts.days) ||
        !object(settings) || !keys(settings, ['schemaVersion', 'muted', 'opened']) || settings.schemaVersion !== 1 ||
        !validSettings({ muted: settings.muted, opened: settings.opened })) throw new Error('保存データの形式が不正です。元のファイルは保持しています。');
    return { counts: counts.days, settings: { muted: settings.muted as Settings['muted'], opened: settings.opened as boolean } };
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
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw new Error('保存データを読み込めません。元のファイルは保持しています。');
    }
  }
  private write(name: string, document: unknown): Promise<void> {
    const result = this.work.then(async () => {
      await mkdir(this.directory, { recursive: true });
      const temporary = join(this.directory, name + '.tmp');
      const handle = await open(temporary, 'w');
      try { await handle.writeFile(JSON.stringify(document), 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, join(this.directory, name));
    });
    this.work = result.catch(() => {}); return result;
  }
}
