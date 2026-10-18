import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { mkdir, access } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { SerialQueue } from '../core/serial-queue.ts';
import type { Settings } from '../shared/coach.ts';
import type { DurableRepository, RecordMutation, RecordRange, StorageState } from '../shared/storage.ts';
import { JsonRepository } from './repository.ts';

async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
export async function selectRepository(root: string, workerPath: string): Promise<JsonRepository | SqliteRepository> {
  // Existing authority wins even if DB is missing or broken; never import/fall back to old JSON.
  const sqlite = await exists(join(root, 'records-v1'));
  const legacy = await exists(join(root, 'counts.json')) || await exists(join(root, 'settings.json'));
  return sqlite || !legacy ? new SqliteRepository(root, workerPath) : new JsonRepository(root);
}
export class SqliteRepository implements DurableRepository {
  readonly session = randomUUID();
  private worker: Worker | null = null;
  private requestId = 0;
  private queue = new SerialQueue();
  private lock = false;
  private owner: Server | null = null;
  private terminating: Promise<unknown> = Promise.resolve();
  private claimed = false;
  private closed = false;
  private root: string;
  private workerPath: string;
  constructor(directory: string, workerPath: string) { this.root = join(directory, 'records-v1'); this.workerPath = workerPath; }
  private async acquire(): Promise<void> {
    if (this.lock) return;
    await mkdir(this.root, { recursive: true });
    const identity = createHash('sha256').update(this.root.toLowerCase()).digest('hex').slice(0, 32);
    const path = process.platform === 'win32' ? `\\\\.\\pipe\\shortcut-coach-${identity}` : join(tmpdir(), `shortcut-coach-${identity}.sock`);
    const owner = createServer(socket => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      owner.once('error', () => reject(new Error('WRITER_ALREADY_ACTIVE')));
      owner.listen({ path, exclusive: true }, () => resolve());
    });
    // The OS releases ownership on process death; there is no stale-file/PID-reuse race.
    this.owner = owner; this.lock = true;
  }
  private async connect(): Promise<Worker> {
    if (this.closed) throw new Error('STORAGE_CLOSED');
    await this.terminating;
    if (this.worker) return this.worker;
    await this.acquire();
    const worker = new Worker(this.workerPath, { workerData: { root: this.root } });
    // Both the startup and each request have bounded waits; errors never reach UI with paths.
    worker.on('error', () => {});
    try { await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { void worker.terminate(); reject(new Error('STORAGE_TIMEOUT')); }, 5000);
      const finish = (error?: Error) => { clearTimeout(timeout); worker.off('message', message); worker.off('error', failed); worker.off('exit', exited); error ? reject(error) : resolve(); };
      const message = (v: { ready: boolean }) => finish(v.ready ? undefined : new Error('STORAGE_OPEN_FAILED'));
      const failed = () => finish(new Error('STORAGE_OPEN_FAILED'));
      const exited = () => finish(new Error('STORAGE_EXIT'));
      worker.once('message', message); worker.once('error', failed); worker.once('exit', exited);
    }); } catch (error) { await worker.terminate(); throw error; }
    worker.once('exit', () => { if (this.worker === worker) this.worker = null; });
    this.worker = worker;
    return worker;
  }
  private async request<T>(action: string, ...args: unknown[]): Promise<T> {
    const worker = await this.connect(); const id = ++this.requestId;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => failed(), 5000);
      const cleanup = () => { clearTimeout(timeout); worker.off('message', message); worker.off('error', failed); worker.off('exit', failed); };
      const failed = () => { cleanup(); if (this.worker === worker) this.worker = null; this.terminating = worker.terminate(); reject(new Error('STORAGE_RESPONSE_UNKNOWN')); };
      const message = (v: { id: number; ok: boolean; result: T }) => {
        if (v.id !== id) return; cleanup(); v.ok ? resolve(v.result) : reject(new Error('STORAGE_FAILED'));
      };
      worker.on('message', message); worker.once('error', failed); worker.once('exit', failed);
      worker.postMessage({ id, action, args });
    });
  }
  load(today: string): Promise<StorageState> {
    return this.queue.run(async () => {
      const loaded = await this.request<StorageState>('load', today);
      if (!this.claimed) { await this.request('claim', this.session); this.claimed = true; }
      return loaded;
    });
  }
  commit(value: RecordMutation): Promise<void> { return this.queue.run(() => this.request('commit', value)); }
  query(from: string, to: string): Promise<RecordRange> { return this.queue.run(() => this.request('query', from, to)); }
  saveSettings(value: Settings): Promise<void> { return this.queue.run(() => this.request('settings', value)); }
  reconnect(): Promise<void> {
    return this.queue.run(async () => {
      const worker = this.worker; this.worker = null;
      if (worker) await worker.terminate();
      await this.terminating;
      // Preserve the process writeSession and checkpoint. Reconnection must never claim a fresh session.
    });
  }
  close(): Promise<void> {
    return this.queue.run(async () => {
      const worker = this.worker;
      if (worker) {
        try { await this.request('close'); } catch { /* Failed shutdown still releases this process's Worker. */ }
        await worker.terminate();
      }
      this.closed = true; this.worker = null;
      await this.terminating;
      if (this.owner) { const owner = this.owner; await new Promise<void>((resolve) => owner.close(() => resolve())); this.owner = null; this.lock = false; }
    });
  }
}
