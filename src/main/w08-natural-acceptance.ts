import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { Snapshot, LearningState, OperationId } from '../shared/coach.ts';
import { learningState } from '../shared/learning.ts';

type Plan = { kind: 'mouse' | 'key' | 'negative'; application: 'standard' | 'chrome'; state: LearningState; paused: boolean };
type Deps = { snapshot(): Snapshot; start(paused: boolean): Promise<void>; stop(): Promise<void>; idle(): Promise<void>;
  configure(state: LearningState): Promise<void>; now?(): number };
const total = (snapshot: Snapshot) => Object.values(snapshot.counts).reduce((sum, day) =>
  ({ mouse: sum.mouse + (day.W08?.mouse ?? 0), key: sum.key + (day.W08?.key ?? 0) }), { mouse: 0, key: 0 });
export class W08NaturalTrials {
  private active: { plan: Plan; before: ReturnType<typeof total>; requests: number; tracking: boolean;
    interrupted: boolean; expired: boolean; expires: number } | null = null;
  readonly results: object[] = [];
  get armed() { return this.active !== null; }
  private deps: Deps;
  constructor(deps: Deps) { this.deps = deps; }
  noticeRequested(operation: OperationId) { if (operation === 'W08' && this.active) this.active.requests++; }
  observe(snapshot: Snapshot) {
    if (this.active?.tracking && (!snapshot.observing || snapshot.error || snapshot.pendingSave)) this.active.interrupted = true;
  }
  expire() { if (this.active) this.active.expired = true; }
  private now() { return this.deps.now?.() ?? performance.now(); }
  async arm(value: unknown) {
    if (this.active || typeof value !== 'object' || !value) throw new Error('invalid-plan');
    const p = value as Record<string, unknown>;
    if (typeof p.kind !== 'string' || !['mouse', 'key', 'negative'].includes(p.kind) ||
        typeof p.application !== 'string' || !['standard', 'chrome'].includes(p.application) ||
        typeof p.state !== 'string' || !['learning', 'mastered', 'excluded'].includes(p.state) || typeof p.paused !== 'boolean') throw new Error('invalid-plan');
    await this.deps.stop(); await this.deps.idle();
    await this.deps.configure(p.state as LearningState);
    if (this.deps.snapshot().error || this.deps.snapshot().pendingSave) throw new Error('product-error');
    this.active = { plan: { kind: p.kind as Plan['kind'], application: p.application as Plan['application'],
      state: p.state as LearningState, paused: p.paused }, before: total(this.deps.snapshot()), requests: 0,
      tracking: false, interrupted: false, expired: false, expires: 0 };
    try {
      await this.deps.start(p.paused);
      if (!this.deps.snapshot().observing || this.deps.snapshot().error) throw new Error('observation-not-started');
      this.active.tracking = true; this.active.expires = this.now() + 45_000;
    } catch (error) { this.active = null; await this.deps.stop(); throw error; }
  }
  async finish(completed: boolean) {
    const trial = this.active;
    if (!trial) return;
    trial.expired ||= this.now() >= trial.expires;
    trial.tracking = false;
    await this.deps.stop(); await this.deps.idle();
    const snapshot = this.deps.snapshot(), after = total(snapshot);
    this.active = null;
    const counts = { mouse: after.mouse - trial.before.mouse, key: after.key - trial.before.key };
    const expectedRequests = trial.plan.kind === 'mouse' && trial.plan.state === 'learning' && !trial.plan.paused ? 1 : 0;
    const valid = completed && !trial.expired && !trial.interrupted && !snapshot.error && !snapshot.pendingSave && !snapshot.observing &&
      learningState(snapshot.settings, 'W08') === trial.plan.state && snapshot.notificationsPaused === trial.plan.paused;
    const detectorPassed = valid && counts.mouse === (trial.plan.kind === 'mouse' ? 1 : 0) && counts.key === (trial.plan.kind === 'key' ? 1 : 0);
    this.results.push({ trial: this.results.length + 1, ...trial.plan, completed, valid, interrupted: trial.interrupted, expired: trial.expired, counts,
      notificationRequests: trial.requests, detectorPassed, notificationRequestPassed: valid && trial.requests === expectedRequests });
  }
}

// Opt-in operator control only. Normal execution never reads these files or collects trial results.
export function runW08NaturalAcceptance(directory: string, deps: Deps, quit: () => Promise<void>) {
  const trials = new W08NaturalTrials(deps);
  let sequence = 0, busy = false, expired = false;
  let deadline: NodeJS.Timeout | undefined;
  let trialRetry: NodeJS.Timeout | undefined, shutdownRetry: NodeJS.Timeout | undefined;
  const status = async (error = false) => {
    const text = JSON.stringify({ sequence, state: trials.armed ? 'ARMED' : expired ? 'CLOSED' : 'IDLE', error,
      results: trials.results, visibleNotification: 'unverified; API requests are not visible OS delivery' });
    await writeFile(join(directory, 'status.tmp'), text);
    await rename(join(directory, 'status.tmp'), join(directory, 'status.json'));
  };
  const finish = async (completed: boolean) => { clearTimeout(deadline); clearTimeout(trialRetry); await trials.finish(completed); await status(); };
  const timer = setInterval(async () => {
    if (busy || expired) return;
    busy = true;
    try {
      let raw: string;
      try { raw = await readFile(join(directory, 'control.json'), 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      if (raw.length > 1024) throw new Error('invalid-control');
      const request = JSON.parse(raw);
      if (!Number.isSafeInteger(request.sequence) || request.sequence <= sequence) return;
      sequence = request.sequence;
      if (request.action === 'arm') {
        await trials.arm(request.plan);
        deadline = setTimeout(() => {
          trials.expire(); void deps.stop().catch(() => {}); void queueFinish();
        }, 45_000);
        await status();
      } else if (request.action === 'finish' || request.action === 'cancel') await finish(request.action === 'finish');
      else if (request.action === 'end') { await finish(false); expired = true; await status(); await quit(); }
      else throw new Error('invalid-action');
    } catch { await deps.stop(); await trials.finish(false); await status(true); }
    finally { busy = false; }
  }, 150);
  async function queueFinish(end = false) {
    if (busy) {
      if (end) shutdownRetry = setTimeout(() => { void queueFinish(true); }, 100);
      else trialRetry = setTimeout(() => { void queueFinish(false); }, 100);
      return;
    }
    busy = true;
    try { await finish(false); if (end) await quit(); } finally { busy = false; }
  }
  const sessionDeadline = setTimeout(() => {
    expired = true; trials.expire(); clearInterval(timer); clearTimeout(deadline);
    void deps.stop().catch(() => {});
    void queueFinish(true);
  }, 20 * 60_000);
  void status();
  console.log('W08_NATURAL_READY observation stopped; arm in operator panel; 45s trial deadline');
  return { observe: (snapshot: Snapshot) => trials.observe(snapshot), noticeRequested: (operation: OperationId) => trials.noticeRequested(operation),
    dispose: () => { clearInterval(timer); clearTimeout(deadline); clearTimeout(trialRetry); clearTimeout(shutdownRetry); clearTimeout(sessionDeadline); } };
}
