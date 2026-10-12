import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import type { Bounds, Candidate } from '../shared/coach';

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function protocolId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 0x7fffffff;
}
const responseTypes: Record<string, string> = {
  start: 'started', stop: 'stopped', shutdown: 'stopped', queryDisplayContext: 'displayContext',
  fixtureCandidate: 'injected', fixtureFocus: 'focus'
};
export function candidate(value: unknown): Candidate | null {
  if (!record(value) || value.type !== 'candidate' || value.protocolVersion !== 1 ||
      !protocolId(value.generation) || !protocolId(value.sequence) ||
      typeof value.app !== 'string' || typeof value.operation !== 'string' || typeof value.date !== 'string' ||
      !record(value.before) || typeof value.before.state !== 'string' ||
      !(value.before.arranged === null || typeof value.before.arranged === 'boolean') ||
      !record(value.after) || typeof value.after.state !== 'string' ||
      typeof value.origin !== 'string' || !['mouse', 'key', 'unknown'].includes(value.origin) || typeof value.route !== 'string' ||
      !['injected', 'conflicted', 'moving', 'targetMatched', 'elevated'].every((key) => typeof value[key] === 'boolean') ||
      typeof value.inputAgeMs !== 'number' || !Number.isFinite(value.inputAgeMs)) return null;
  let monitor: Bounds | null = null;
  const rawMonitor = value.monitor;
  if (record(rawMonitor) && ['x', 'y', 'width', 'height'].every((key) => typeof rawMonitor[key] === 'number' && Number.isFinite(rawMonitor[key]))) {
    const bounds = rawMonitor as Bounds;
    if (bounds.width > 0 && bounds.height > 0) monitor = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  }
  return { type: 'candidate', protocolVersion: 1, generation: value.generation as number, sequence: value.sequence as number,
    app: value.app, operation: value.operation, date: value.date,
    before: { state: value.before.state, arranged: value.before.arranged }, after: { state: value.after.state },
    origin: value.origin as Candidate['origin'], route: value.route, injected: value.injected as boolean,
    conflicted: value.conflicted as boolean, moving: value.moving as boolean, elevated: value.elevated as boolean, targetMatched: value.targetMatched as boolean,
    inputAgeMs: value.inputAgeMs, monitor };
}

export class ObserverClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private generation = 0;
  private requestId = 0;
  private fixture: boolean;
  private onCandidate: (candidate: Candidate) => void;
  private onFault: () => void;
  private ready: { resolve(): void; reject(error: Error): void; timer: NodeJS.Timeout } | null = null;
  private active = false;
  private closing = false;
  private arrangedAvailable = false;
  private pending = new Map<number, { type: string; resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  constructor(onCandidate: (candidate: Candidate) => void, onFault: () => void, fixture = false) {
    this.onCandidate = onCandidate; this.onFault = onFault; this.fixture = fixture;
  }
  async start(): Promise<number> {
    if (!this.child) {
      this.closing = false;
      const path = app.isPackaged ? join(process.resourcesPath, 'native-helper', 'WindowObserver.exe')
        : join(app.getAppPath(), 'resources', 'native-helper', 'WindowObserver.exe');
      const mode = this.fixture ? process.argv.includes('--real-display-smoke') ? '--fixture-display' : '--fixture' : '--observe';
      this.child = spawn(path, [mode], { cwd: dirname(path), windowsHide: true, stdio: 'pipe' });
      const child = this.child;
      let buffered = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (text: string) => {
        if (this.child !== child) return;
        const parts = text.split('\n');
        for (let index = 0; index < parts.length; index++) {
          if (buffered.length + parts[index].length > 16384) { buffered = ''; this.failed(); return; }
          buffered += parts[index];
          if (index < parts.length - 1) {
            this.receive(buffered.replace(/\r$/, '')); buffered = '';
            if (this.child !== child) return;
          }
        }
      });
      child.stdout.on('end', () => { if (this.child === child && !this.closing) this.failed(); });
      child.stderr.resume();
      child.on('error', () => { if (this.child === child) this.failed(); });
      child.on('exit', () => {
        if (this.child !== child) return;
        if (this.closing) this.child = null; else this.failed();
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { this.ready = null; this.failed(); reject(new Error('helper-ready-timeout')); }, 5000);
        this.ready = { resolve, reject, timer };
      });
      if (!this.arrangedAvailable && !this.fixture) {
        await this.shutdown(); throw new Error('arranged-api-unavailable');
      }
    }
    const generation = ++this.generation;
    const result = await this.request('start', { generation });
    if (result.type !== 'started') throw new Error('helper-not-started');
    this.active = true; return generation;
  }
  async stop(): Promise<void> {
    this.active = false;
    if (!this.child) return;
    try { const response = await this.request('stop'); if (response.type !== 'stopped') throw new Error('stop'); }
    catch { this.failed(); throw new Error('helper-stop-failed'); }
  }
  async shutdown(): Promise<void> {
    this.closing = true; this.active = false;
    const child = this.child;
    if (!child) return;
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null) { resolve(); return; }
      const done = () => { clearTimeout(timer); child.removeListener('exit', done); resolve(); };
      const timer = setTimeout(() => { child.kill(); done(); }, 2500);
      child.once('exit', done);
    });
    try { await this.request('shutdown'); }
    catch { child.kill(); }
    finally {
      child.stdin.end();
      await exited;
      if (this.child === child) this.child = null;
    }
  }
  async context(monitor: Bounds): Promise<{ known: boolean; fullscreen: boolean }> {
    const response = await this.request('queryDisplayContext', { monitor });
    const value = response.result;
    return record(value) && value.known === true && typeof value.fullscreen === 'boolean'
      ? { known: true, fullscreen: value.fullscreen } : { known: false, fullscreen: true };
  }
  async inject(value: Candidate): Promise<void> {
    if (!this.fixture) throw new Error('fixture-only');
    await this.request('fixtureCandidate', { candidate: value });
  }
  async focusToken(): Promise<unknown> { return (await this.request('fixtureFocus')).result; }
  private request(command: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!this.child || this.child.stdin.destroyed) return Promise.reject(new Error('helper-unavailable'));
    const requestId = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('helper-request-timeout')); }, 2500);
      this.pending.set(requestId, { type: responseTypes[command], resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ command, requestId, ...extra }) + '\n', (error) => {
        if (error) { clearTimeout(timer); this.pending.delete(requestId); reject(error); }
      });
    });
  }
  private receive(line: string): void {
    try {
      if (line.length > 16384) throw new Error('oversize');
      const message: unknown = JSON.parse(line);
      if (!record(message)) throw new Error('protocol');
      if (message.type === 'ready' && message.protocolVersion === 1) {
        this.arrangedAvailable = message.arrangedAvailable === true;
        if (this.ready) { clearTimeout(this.ready.timer); this.ready.resolve(); this.ready = null; }
        return;
      }
      if (message.type === 'candidate') {
        const value = candidate(message);
        if (!value) throw new Error('candidate');
        if (this.active && value.generation === this.generation) this.onCandidate(value);
        return;
      }
      const pending = this.pending.get(message.requestId as number);
      if (pending) {
        if (message.type !== 'fault' && message.type !== pending.type) throw new Error('response-type');
        clearTimeout(pending.timer); this.pending.delete(message.requestId as number);
        if (message.type === 'fault') pending.reject(new Error('helper-fault')); else pending.resolve(message);
      }
      if (message.type === 'fault') this.failed();
    } catch { this.failed(); }
  }
  private failed(): void {
    this.active = false;
    const child = this.child;
    this.child = null;
    child?.kill();
    if (this.ready) { clearTimeout(this.ready.timer); this.ready.reject(new Error('helper-failed')); this.ready = null; }
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('helper-failed')); }
    this.pending.clear();
    if (child && !this.closing) this.onFault();
  }
}
