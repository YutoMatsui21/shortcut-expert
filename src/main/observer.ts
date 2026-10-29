import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import type { Bounds, Candidate, CandidateV2, Evidence, ObserverCandidate } from '../shared/coach';

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function protocolId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 0x7fffffff;
}
function bounds(value: unknown): Bounds | null {
  if (!record(value) || !['x', 'y', 'width', 'height'].every((key) => typeof value[key] === 'number' && Number.isFinite(value[key])) ||
      (value.width as number) <= 0 || (value.height as number) <= 0) return null;
  return { x: value.x as number, y: value.y as number, width: value.width as number, height: value.height as number };
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
  if ('afterArranged' in value && value.afterArranged !== null && typeof value.afterArranged !== 'boolean') return null;
  if (['fromMonitor', 'toMonitor'].some((key) => key in value && value[key] !== null && bounds(value[key]) === null)) return null;
  if ('moveDirection' in value && value.moveDirection !== null && !['left', 'right'].includes(value.moveDirection as string)) return null;
  if ('moveConfirmed' in value && typeof value.moveConfirmed !== 'boolean') return null;
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
    inputAgeMs: value.inputAgeMs, monitor,
    ...('afterArranged' in value ? { afterArranged: value.afterArranged as boolean | null } : {}),
    ...('fromMonitor' in value ? { fromMonitor: bounds(value.fromMonitor) } : {}),
    ...('toMonitor' in value ? { toMonitor: bounds(value.toMonitor) } : {}),
    ...('moveDirection' in value ? { moveDirection: value.moveDirection as 'left' | 'right' | null } : {}),
    ...('moveConfirmed' in value ? { moveConfirmed: value.moveConfirmed as boolean } : {}) };
}

function nullableBoolean(value: unknown): value is boolean | null { return value === null || typeof value === 'boolean'; }
export function candidateV2(value: unknown): CandidateV2 | null {
  if (!record(value) || value.type !== 'candidate' || value.protocolVersion !== 2 ||
      !protocolId(value.generation) || !protocolId(value.sequence) || !protocolId(value.transaction) ||
      typeof value.date !== 'string' || typeof value.route !== 'string' || value.route.length > 64 ||
      !(value.origin === 'mouse' || value.origin === 'key' || value.origin === 'unknown') ||
      typeof value.injected !== 'boolean' || typeof value.conflicted !== 'boolean' || !record(value.evidence)) return null;
  const raw = value.evidence;
  let evidence: Evidence;
  switch (raw.kind) {
    case 'compound-drag': {
      const fromMonitor = bounds(raw.fromMonitor), toMonitor = bounds(raw.toMonitor);
      if (raw.profile !== 'compound-drag-v1' || !['maximized', 'left-top', 'right-top', 'left-bottom', 'right-bottom'].includes(raw.terminal as string) ||
          !['targetMatched', 'released', 'layoutStable', 'terminalEquivalent'].every(key => typeof raw[key] === 'boolean') ||
          typeof raw.inputAgeMs !== 'number' || !Number.isFinite(raw.inputAgeMs) || raw.inputAgeMs < 0 || !fromMonitor || !toMonitor ||
          !(raw.moveDirection === null || raw.moveDirection === 'left' || raw.moveDirection === 'right')) return null;
      evidence = { kind: raw.kind, profile: raw.profile, terminal: raw.terminal as Extract<Evidence, { kind: 'compound-drag' }>['terminal'],
        targetMatched: raw.targetMatched as boolean, released: raw.released as boolean, layoutStable: raw.layoutStable as boolean,
        terminalEquivalent: raw.terminalEquivalent as boolean, inputAgeMs: raw.inputAgeMs, fromMonitor, toMonitor, moveDirection: raw.moveDirection }; break;
    }
    case 'window-close':
      if (raw.profile !== 'window-close-v1' || typeof raw.targetMatched !== 'boolean' || typeof raw.destroyed !== 'boolean' ||
          typeof raw.inputAgeMs !== 'number' || !Number.isFinite(raw.inputAgeMs) || raw.inputAgeMs < 0 ||
          !(raw.monitor === null || bounds(raw.monitor))) return null;
      evidence = { kind: raw.kind, profile: raw.profile, targetMatched: raw.targetMatched, destroyed: raw.destroyed,
        inputAgeMs: raw.inputAgeMs, monitor: bounds(raw.monitor) }; break;
    case 'placement': {
      const monitor = bounds(raw.monitor);
      if (raw.profile !== 'placement-v1' || !['left-half', 'right-half', 'left-top', 'right-top', 'left-bottom', 'right-bottom'].includes(raw.shape as string) ||
          typeof raw.targetMatched !== 'boolean' || typeof raw.monitorChanged !== 'boolean' ||
          typeof raw.inputAgeMs !== 'number' || !Number.isFinite(raw.inputAgeMs) || raw.inputAgeMs < 0 || !monitor) return null;
      evidence = { kind: raw.kind, profile: raw.profile, shape: raw.shape as Extract<Evidence, { kind: 'placement' }>['shape'],
        targetMatched: raw.targetMatched, monitorChanged: raw.monitorChanged, inputAgeMs: raw.inputAgeMs, monitor }; break;
    }
    case 'window-switch':
      if (raw.profile !== 'window-switch-v1' ||
          !['windowsDifferent', 'eligible', 'inputTargetMatched', 'foregroundMatched'].every(key => typeof raw[key] === 'boolean') ||
          typeof raw.inputAgeMs !== 'number' || !Number.isFinite(raw.inputAgeMs) || raw.inputAgeMs < 0 ||
          typeof raw.settleMs !== 'number' || !Number.isFinite(raw.settleMs) || raw.settleMs < 0 ||
          !(raw.monitor === null || bounds(raw.monitor))) return null;
      evidence = { kind: raw.kind, profile: raw.profile, windowsDifferent: raw.windowsDifferent as boolean,
        eligible: raw.eligible as boolean, inputTargetMatched: raw.inputTargetMatched as boolean,
        foregroundMatched: raw.foregroundMatched as boolean, inputAgeMs: raw.inputAgeMs, settleMs: raw.settleMs,
        monitor: bounds(raw.monitor) }; break;
    case 'taskbar-input':
      if (raw.profile !== 'taskbar-input-v1' || !(raw.slot === null || (protocolId(raw.slot) && raw.slot <= 10)) ||
          typeof raw.mappingConfirmed !== 'boolean' ||
          typeof raw.snapshotAgeMs !== 'number' || !Number.isFinite(raw.snapshotAgeMs) || raw.snapshotAgeMs < 0 ||
          typeof raw.confirmationAgeMs !== 'number' || !Number.isFinite(raw.confirmationAgeMs) || raw.confirmationAgeMs < 0 ||
          !(raw.monitor === null || bounds(raw.monitor))) return null;
      evidence = { kind: raw.kind, profile: raw.profile, slot: raw.slot, mappingConfirmed: raw.mappingConfirmed,
        snapshotAgeMs: raw.snapshotAgeMs, confirmationAgeMs: raw.confirmationAgeMs, monitor: bounds(raw.monitor) }; break;
    case 'snap-invocation':
      if (raw.profile !== 'snap-invocation-v1' || typeof raw.targetMatched !== 'boolean' || typeof raw.eligible !== 'boolean' ||
          !nullableBoolean(raw.settingsEnabled) || ![null, 'title-rect', 'hit-fallback'].includes(raw.buttonSource as null | string) ||
          typeof raw.dwellMs !== 'number' || !Number.isFinite(raw.dwellMs) || raw.dwellMs < 0 ||
          typeof raw.inputAgeMs !== 'number' || !Number.isFinite(raw.inputAgeMs) || raw.inputAgeMs < 0 ||
          !(raw.monitor === null || bounds(raw.monitor))) return null;
      evidence = { kind: raw.kind, profile: raw.profile, targetMatched: raw.targetMatched, eligible: raw.eligible,
        settingsEnabled: raw.settingsEnabled, buttonSource: raw.buttonSource as 'title-rect' | 'hit-fallback' | null,
        dwellMs: raw.dwellMs, inputAgeMs: raw.inputAgeMs, monitor: bounds(raw.monitor) }; break;
    case 'window': {
      if (!(raw.profile === 'legacy-window-v1' || raw.profile === 'unverified') || !record(raw.result)) return null;
      const result = candidate({ ...raw.result, type: 'candidate', protocolVersion: 1,
        generation: value.generation, sequence: value.sequence, date: value.date, origin: value.origin,
        route: value.route, injected: value.injected, conflicted: value.conflicted });
      if (!result || result.afterArranged === undefined || result.fromMonitor === undefined || result.toMonitor === undefined || result.moveDirection === undefined ||
          !(raw.result.monitor === null || bounds(raw.result.monitor))) return null;
      const { type, protocolVersion, generation, sequence, date, origin, route, injected, conflicted, ...window } = result;
      evidence = { kind: 'window', profile: raw.profile, result: { ...window, afterArranged: result.afterArranged,
        fromMonitor: result.fromMonitor, toMonitor: result.toMonitor, moveDirection: result.moveDirection } }; break;
    }
    case 'shell-display':
      if (raw.profile !== 'unverified' || !(raw.feature === 'task-view' || raw.feature === 'snap-layout') ||
          !nullableBoolean(raw.wasVisible) || !nullableBoolean(raw.visible) || !nullableBoolean(raw.targetMatched)) return null;
      evidence = { kind: raw.kind, profile: raw.profile, feature: raw.feature, wasVisible: raw.wasVisible,
        visible: raw.visible, targetMatched: raw.targetMatched }; break;
    case 'activation':
      if (raw.profile !== 'unverified' || !(raw.slot === null || (protocolId(raw.slot) && raw.slot <= 9)) ||
          !nullableBoolean(raw.appMatched) || !nullableBoolean(raw.targetMatched) || !nullableBoolean(raw.individualEquivalent) ||
          !(raw.result === 'launched' || raw.result === 'activated' || raw.result === 'unknown')) return null;
      evidence = { kind: raw.kind, profile: raw.profile, slot: raw.slot, appMatched: raw.appMatched,
        targetMatched: raw.targetMatched, individualEquivalent: raw.individualEquivalent, result: raw.result }; break;
    case 'global':
      if (raw.profile !== 'unverified' || !(raw.feature === 'desktop' || raw.feature === 'minimize-all') ||
          !nullableBoolean(raw.targetsKnown) || !nullableBoolean(raw.resultConfirmed)) return null;
      evidence = { kind: raw.kind, profile: raw.profile, feature: raw.feature,
        targetsKnown: raw.targetsKnown, resultConfirmed: raw.resultConfirmed }; break;
    default: return null;
  }
  return { type: 'candidate', protocolVersion: 2, generation: value.generation, sequence: value.sequence,
    transaction: value.transaction, date: value.date, origin: value.origin, route: value.route,
    injected: value.injected, conflicted: value.conflicted, evidence };
}

export class ObserverClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private processes = new Map<ChildProcessWithoutNullStreams, Promise<void>>();
  private generation = 0;
  private requestId = 0;
  private fixture: boolean;
  private onCandidate: (candidate: ObserverCandidate) => void;
  private onFault: () => void;
  private ready: { resolve(): void; reject(error: Error): void; timer: NodeJS.Timeout } | null = null;
  private active = false;
  private closing = false;
  private arrangedAvailable = false;
  private protocol: 1 | 2 = 1;
  private v2Available = false;
  private pending = new Map<number, { type: string; resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  constructor(onCandidate: (candidate: ObserverCandidate) => void, onFault: () => void, fixture = false) {
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
      // A failed transport retires a child, but kill() alone does not confirm its exit.
      this.processes.set(child, new Promise<void>(resolve => {
        const done = () => { this.processes.delete(child); resolve(); };
        child.once('exit', done);
        child.once('error', () => { if (!child.pid) done(); });
      }));
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
    this.protocol = this.v2Available ? 2 : 1;
    const result = await this.request('start', { generation, protocolVersion: this.protocol });
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
    const waits = [...this.processes].map(async ([process, exited]) => {
      const kill = setTimeout(() => process.kill(), 2500);
      let deadline: NodeJS.Timeout | undefined;
      try {
        await Promise.race([exited, new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error('helper-exit-unconfirmed')), 5000);
        })]);
      } finally { clearTimeout(kill); clearTimeout(deadline); }
    });
    const shutdown = async () => {
      if (!child) return;
      try { await this.request('shutdown'); }
      catch { child.kill(); }
      finally { child.stdin.end(); }
    };
    await Promise.all([shutdown(), ...waits]);
    if (this.child === child) this.child = null;
  }
  async context(monitor: Bounds): Promise<{ known: boolean; fullscreen: boolean }> {
    const response = await this.request('queryDisplayContext', { monitor });
    const value = response.result;
    return record(value) && value.known === true && typeof value.fullscreen === 'boolean'
      ? { known: true, fullscreen: value.fullscreen } : { known: false, fullscreen: true };
  }
  async inject(value: ObserverCandidate): Promise<void> {
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
        this.v2Available = Array.isArray(message.supportedProtocols) && message.supportedProtocols.includes(2);
        if (this.ready) { clearTimeout(this.ready.timer); this.ready.resolve(); this.ready = null; }
        return;
      }
      if (message.type === 'candidate') {
        const value = message.protocolVersion === 2 ? candidateV2(message) : candidate(message);
        if (!value) throw new Error('candidate');
        if (value.protocolVersion !== this.protocol) throw new Error('candidate-protocol');
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
