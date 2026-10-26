import type { Candidate, CandidateV2 } from '../../src/shared/coach.ts';
export function taskbarFixture(origin: 'mouse' | 'key' = 'mouse', sequence = 1, slot = 10): CandidateV2 {
  return { type: 'candidate', protocolVersion: 2, generation: 1, sequence, transaction: sequence,
    date: '2026-10-21', origin, route: origin === 'mouse' ? 'taskbar-click' : 'win-digit', injected: false, conflicted: false,
    evidence: { kind: 'taskbar-input', profile: 'taskbar-input-v1', slot, mappingConfirmed: true,
      snapshotAgeMs: 200, confirmationAgeMs: 250, monitor: { x: 0, y: 0, width: 1920, height: 1080 } } };
}
export function snapFixture(origin: 'mouse' | 'key' = 'mouse', sequence = 1): CandidateV2 {
  return { type: 'candidate', protocolVersion: 2, generation: 1, sequence, transaction: sequence,
    date: '2026-10-21', origin, route: origin === 'mouse' ? 'max-button-hover' : 'win-z', injected: false, conflicted: false,
    evidence: { kind: 'snap-invocation', profile: 'snap-invocation-v1', eligible: true, targetMatched: true,
      settingsEnabled: true, buttonSource: origin === 'mouse' ? 'title-rect' : null, dwellMs: origin === 'mouse' ? 500 : 0,
      inputAgeMs: 0, monitor: { x: 0, y: 0, width: 1920, height: 1080 } } };
}

export function v2Fixture(legacy = candidateFixture(), transaction = legacy.sequence): CandidateV2 {
  const { type, protocolVersion, generation, sequence, date, origin, route, injected, conflicted, ...result } = legacy;
  return { type, protocolVersion: 2, generation, sequence, transaction, date, origin, route, injected, conflicted,
    evidence: { kind: 'window', profile: 'legacy-window-v1', result: {
      ...result, afterArranged: result.afterArranged ?? null, fromMonitor: result.fromMonitor ?? null,
      toMonitor: result.toMonitor ?? null, moveDirection: result.moveDirection ?? null
    } } };
}

export function candidateFixture(overrides: Partial<Candidate> = {}): Candidate {
  return {
    type: 'candidate', protocolVersion: 1, generation: 1, sequence: 1,
    app: 'chrome', operation: 'maximize', date: '2026-10-11',
    before: { state: 'normal', arranged: false }, after: { state: 'maximized' },
    origin: 'mouse', route: 'max-button', injected: false, conflicted: false,
    moving: false, elevated: false, targetMatched: true, inputAgeMs: 135,
    monitor: { x: 0, y: 0, width: 1920, height: 1080 }, ...overrides
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
export function switchFixture(origin: 'mouse' | 'key' = 'mouse', sequence = 1): import('../../src/shared/coach.ts').CandidateV2 & {
  evidence: Extract<import('../../src/shared/coach.ts').Evidence, { kind: 'window-switch' }>
} {
  return { type: 'candidate', protocolVersion: 2, generation: 1, sequence, transaction: sequence,
    date: '2026-10-21', origin, route: origin === 'mouse' ? 'direct-click' : 'alt-tab', injected: false, conflicted: false,
    evidence: { kind: 'window-switch', profile: 'window-switch-v1', windowsDifferent: true, eligible: true,
      inputTargetMatched: true, foregroundMatched: true, inputAgeMs: 500, settleMs: 300,
      monitor: { x: 0, y: 0, width: 1920, height: 1080 } } };
}
