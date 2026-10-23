import type { Bounds, Candidate, ObserverCandidate, Observation, OperationId } from '../shared/coach.ts';
import { validDate } from './dates.ts';

export function classify(value: ObserverCandidate): Observation | null {
  if (value.protocolVersion === 1) return classifyWindow(value);
  if (value.evidence.kind === 'snap-invocation') {
    const e = value.evidence;
    if (value.origin !== 'mouse' && value.origin !== 'key') return null;
    if (e.profile !== 'snap-invocation-v1' || !validDate(value.date) || value.injected || value.conflicted ||
        !e.targetMatched || !e.eligible || e.settingsEnabled !== true || e.inputAgeMs < 0 || e.inputAgeMs > 200 ||
        !Number.isFinite(e.inputAgeMs) || !Number.isFinite(e.dwellMs)) return null;
    if (value.origin === 'key' ? value.route !== 'win-z' || e.dwellMs !== 0 || e.buttonSource !== null :
        value.origin !== 'mouse' || value.route !== 'max-button-hover' || e.dwellMs < 500 ||
        !['title-rect', 'hit-fallback'].includes(e.buttonSource ?? '')) return null;
    return { id: `${value.generation}:t${value.transaction}`, operation: 'W08', origin: value.origin,
      date: value.date, shortcut: 'Win + Z', monitor: e.monitor };
  }
  if (value.evidence.kind !== 'window' || value.evidence.profile !== 'legacy-window-v1') return null;
  const observation = classifyWindow({ ...value.evidence.result, type: 'candidate', protocolVersion: 1,
    generation: value.generation, sequence: value.sequence, date: value.date, origin: value.origin,
    route: value.route, injected: value.injected, conflicted: value.conflicted });
  return observation ? { ...observation, id: `${value.generation}:t${value.transaction}` } : null;
}

function classifyWindow(candidate: Candidate): Observation | null {
  if (!validDate(candidate.date) || !Number.isSafeInteger(candidate.sequence) || candidate.sequence < 1 ||
      !['chrome', 'obsidian', 'code', 'chatgpt'].includes(candidate.app) ||
      candidate.elevated !== false || candidate.injected || candidate.conflicted || candidate.moving || !candidate.targetMatched ||
      candidate.inputAgeMs < 0 || candidate.inputAgeMs > 1000 ||
      !['mouse', 'key'].includes(candidate.origin)) return null;
  let operation: OperationId;
  let shortcut: string | null;
  const route = (mouse: string[], key: string[]) => candidate.origin === 'mouse'
    ? mouse.includes(candidate.route) : key.includes(candidate.route);
  switch (candidate.operation) {
    case 'maximize':
      if (candidate.before.state !== 'normal' || candidate.before.arranged === null || candidate.after.state !== 'maximized' ||
          !route(['max-button', 'caption-double-click'], ['win-up'])) return null;
      operation = 'W03'; shortcut = candidate.before.arranged ? null : 'Win + ↑'; break;
    case 'minimize':
      if (!['normal', 'maximized'].includes(candidate.before.state) || candidate.after.state !== 'minimized' ||
          !route(['min-button'], ['win-down'])) return null;
      shortcut = candidate.before.state === 'normal' && candidate.before.arranged === false ? 'Win + ↓' : null;
      if (candidate.origin === 'key' && shortcut === null) return null;
      operation = 'W04'; break;
    case 'restore':
      if (candidate.before.state !== 'maximized' || candidate.after.state !== 'normal' || candidate.afterArranged !== false ||
          !route(['max-button', 'caption-double-click'], ['win-down'])) return null;
      operation = 'W05'; shortcut = 'Win + ↓'; break;
    case 'close':
      if (!['normal', 'maximized'].includes(candidate.before.state) || candidate.after.state !== 'closed' ||
          !route(['close-button'], ['alt-f4'])) return null;
      operation = 'W11'; shortcut = 'Alt + F4'; break;
    case 'monitor-move': {
      const from = candidate.fromMonitor, to = candidate.toMonitor;
      if (!from || !to || sameMonitor(from, to) || candidate.before.state === 'minimized' ||
          !['normal', 'maximized'].includes(candidate.before.state) || !['normal', 'maximized'].includes(candidate.after.state) ||
          !route(['caption-drag'], ['win-shift-left', 'win-shift-right'])) return null;
      const direction = candidate.moveDirection;
      if (direction !== undefined && direction !== null && direction !== 'left' && direction !== 'right') return null;
      if (direction && (direction === 'left' ? to.x >= from.x : to.x <= from.x)) return null;
      if (candidate.origin === 'key' && direction && candidate.route !== `win-shift-${direction}`) return null;
      operation = 'W02'; shortcut = direction ? `Win + Shift + ${direction === 'left' ? '←' : '→'}` : null;
      break;
    }
    default: return null;
  }
  return {
    id: `${candidate.generation}:${candidate.sequence}`, operation,
    origin: candidate.origin === 'key' ? 'key' : 'mouse', date: candidate.date,
    shortcut, monitor: candidate.monitor
  };
}

function sameMonitor(a: Bounds, b: Bounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
