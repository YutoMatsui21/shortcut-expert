import { mkdirSync, mkdtempSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { countsDocument, settingsDocument } from './legacy-documents.ts';
import { StorageStore } from './storage-store.ts';
import { fileExists } from './storage-files.ts';
import type { Counts, Settings } from '../shared/coach.ts';

export type LegacyImport = { identity: string; counts: Counts; settings: Settings };
export function readLegacy(root: string): LegacyImport {
  const read = (name: string) => {
    try { return readFileSync(join(root, name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  };
  const countsBytes = read('counts.json'), settingsBytes = read('settings.json');
  const counts = countsDocument(countsBytes ? JSON.parse(countsBytes.toString('utf8')) : { schemaVersion: 1, days: {} });
  const settings = settingsDocument(settingsBytes ? JSON.parse(settingsBytes.toString('utf8')) : { schemaVersion: 1, muted: [], opened: false });
  if (!counts || !settings) throw new Error('INVALID_LEGACY');
  const digest = createHash('sha256');
  for (const bytes of [countsBytes, settingsBytes]) { digest.update(bytes ? `${bytes.length}:` : 'missing:'); if (bytes) digest.update(bytes); }
  return { identity: digest.digest('hex'), counts, settings };
}
function syncDocument(file: string, value: unknown): void {
  const fd = openSync(file + '.tmp', 'w');
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(file + '.tmp', file);
}
// Called in the sole writer, before the SQLite authority is opened.
export function prepareStorage(target: string): void {
  if (fileExists(target)) return; // Committed authority always wins, including damaged/missing DBs.
  const root = dirname(target), staging = join(root, 'migration-v1');
  const legacy = fileExists(join(root, 'counts.json')) || fileExists(join(root, 'settings.json'));
  if (!legacy && !fileExists(staging)) { mkdirSync(target); return; }
  const source = readLegacy(root);
  const owner = { schemaVersion: 1, identity: source.identity };
  const marker = join(staging, 'source.json');
  if (fileExists(staging)) {
    if (!fileExists(marker) || JSON.stringify(JSON.parse(readFileSync(marker, 'utf8'))) !== JSON.stringify(owner)) throw new Error('MIGRATION_SOURCE_CONFLICT');
  } else {
    // Publish ownership together with its directory. Interrupted preparation contains no DB or record copy.
    const preparing = mkdtempSync(join(root, 'migration-init-'));
    syncDocument(join(preparing, 'source.json'), owner);
    renameSync(preparing, staging);
  }
  const store = new StorageStore(staging, 'staging');
  try { store.importLegacy(source); } finally { store.close(); }
  const reopened = new StorageStore(staging, 'staging');
  try { reopened.verifyLegacy(source); } finally { reopened.close(); }
  if (readLegacy(root).identity !== source.identity) throw new Error('MIGRATION_SOURCE_CHANGED');
  // A same-volume directory rename atomically activates the complete, closed, verified storage set.
  renameSync(staging, target);
}
