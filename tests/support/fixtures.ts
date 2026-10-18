import type { Candidate, CandidateV2 } from '../../src/shared/coach.ts';

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
