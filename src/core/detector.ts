import type { Bounds, WindowEvidenceResult, ObserverCandidate, Observation, OperationId } from '../shared/coach.ts';
import { validDate } from './dates.ts';

// One envelope is one gesture. Never expose one half of an invalid compound result.
export function classifyGesture(value: ObserverCandidate): Observation[] {
  if (value.protocolVersion !== 2 || value.evidence.kind !== 'compound-drag') {
    const single = classify(value); return single ? [single] : [];
  }
  const e = value.evidence;
  if (e.profile !== 'compound-drag-v1' || !validDate(value.date) || value.origin !== 'mouse' ||
      value.route !== 'compound-caption-drag' || value.injected || value.conflicted || !e.targetMatched || !e.released ||
      !e.layoutStable || !Number.isFinite(e.inputAgeMs) || e.inputAgeMs < 0 || e.inputAgeMs > 1000 ||
      sameMonitor(e.fromMonitor, e.toMonitor) || !['maximized', 'left-top', 'right-top', 'left-bottom', 'right-bottom'].includes(e.terminal)) return [];
  const equivalent = e.moveDirection && e.fromMonitor.y === e.toMonitor.y &&
    (e.moveDirection === 'left' ? e.toMonitor.x + e.toMonitor.width <= e.fromMonitor.x : e.fromMonitor.x + e.fromMonitor.width <= e.toMonitor.x);
  const base = { id: `${value.generation}:t${value.transaction}`, origin: 'mouse' as const, date: value.date, monitor: e.toMonitor };
  const [side, vertical] = e.terminal.split('-');
  return [{ ...base, operation: 'W02', shortcut: equivalent ? `Win + Shift + ${e.moveDirection === 'left' ? '←' : '→'}` :
      e.twoDisplayLayoutConfirmed === true && separateMonitors(e.fromMonitor, e.toMonitor) ? 'Win + Shift + ←' : null },
    { ...base, operation: e.terminal === 'maximized' ? 'W03' : 'W07', shortcut: !e.terminalEquivalent ? null :
      e.terminal === 'maximized' ? 'Win + ↑' : `Winを押したまま ${side === 'left' ? '←' : '→'}、続けて ${vertical === 'top' ? '↑' : '↓'}` }];
}

export function classify(value: ObserverCandidate): Observation | null {
  if (value.protocolVersion !== 2) return null;
  if (value.evidence.kind === 'window-close') {
    const e = value.evidence;
    if (!validDate(value.date) || value.injected || value.conflicted || !e.targetMatched || !e.destroyed ||
        e.profile !== 'window-close-v1' || !Number.isFinite(e.inputAgeMs) || e.inputAgeMs < 0 || e.inputAgeMs > 1000 ||
        (value.origin === 'mouse' ? value.route !== 'close-button' : value.origin !== 'key' || value.route !== 'alt-f4')) return null;
    return { id: `${value.generation}:t${value.transaction}`, operation: 'W11', origin: value.origin === 'mouse' ? 'mouse' : 'key',
      date: value.date, shortcut: 'Alt + F4', monitor: e.monitor };
  }
  if (value.evidence.kind === 'placement') {
    const e = value.evidence;
    if (!validDate(value.date) || value.injected || value.conflicted || !e.targetMatched || e.monitorChanged ||
        e.profile !== 'placement-v1' || !Number.isFinite(e.inputAgeMs) || e.inputAgeMs < 0 ||
        (value.origin === 'mouse' ? value.route !== 'caption-edge-drag' || e.inputAgeMs > 1000 :
          value.origin !== 'key' || value.route !== 'win-held-arrows' || e.inputAgeMs > 15000) ||
        !['left-half', 'right-half', 'left-top', 'right-top', 'left-bottom', 'right-bottom'].includes(e.shape)) return null;
    const [side, vertical] = e.shape.split('-');
    const horizontal = side === 'left' ? '←' : '→';
    return { id: `${value.generation}:t${value.transaction}`, operation: vertical === 'half' ? 'W06' : 'W07',
      origin: value.origin === 'mouse' ? 'mouse' : 'key', date: value.date, monitor: e.monitor,
      shortcut: vertical === 'half' ? `Win + ${horizontal}` : `Winを押したまま ${horizontal}、続けて ${vertical === 'top' ? '↑' : '↓'}` };
  }
  if (value.evidence.kind === 'window-switch') {
    const e = value.evidence;
    if ((value.origin !== 'mouse' && value.origin !== 'key') || !validDate(value.date) || value.injected || value.conflicted ||
        e.profile !== 'window-switch-v1' || !e.windowsDifferent || !e.eligible || !e.inputTargetMatched || !e.foregroundMatched ||
        !Number.isFinite(e.inputAgeMs) || e.inputAgeMs < 0 || !Number.isFinite(e.settleMs) || e.settleMs < 0 || e.settleMs > e.inputAgeMs ||
        (value.origin === 'mouse' ? value.route !== 'direct-click' || e.inputAgeMs > 1500 || e.settleMs > 1500 :
          value.route !== 'alt-tab' || e.inputAgeMs > 15000 || e.settleMs < 250 || e.settleMs > 2000)) return null;
    return { id: `${value.generation}:t${value.transaction}`, operation: 'W01', origin: value.origin,
      date: value.date, shortcut: 'Alt + Tab', monitor: e.monitor };
  }
  if (value.evidence.kind === 'taskbar-input') {
    const e = value.evidence;
    if (value.origin !== 'mouse' && value.origin !== 'key') return null;
    if (e.profile !== 'taskbar-input-v1' || !validDate(value.date) || value.injected || value.conflicted ||
        !e.mappingConfirmed || !Number.isInteger(e.slot) || e.slot === null || e.slot < 1 || e.slot > 10 ||
        !Number.isFinite(e.snapshotAgeMs) || e.snapshotAgeMs < 0 || e.snapshotAgeMs > 750 ||
        !Number.isFinite(e.confirmationAgeMs) || e.confirmationAgeMs < 0 || e.confirmationAgeMs > 2500 ||
        (value.origin === 'mouse' ? value.route !== 'taskbar-click' : value.origin !== 'key' || value.route !== 'win-digit')) return null;
    return { id: `${value.generation}:t${value.transaction}`, operation: 'W12', origin: value.origin,
      date: value.date, shortcut: `Win + ${e.slot === 10 ? 0 : e.slot}`, monitor: e.monitor };
  }
  // Historical Snap evidence remains parseable; it is outside the first release.
  if (value.evidence.kind === 'snap-invocation') return null;
  if (value.evidence.kind !== 'window' || value.evidence.profile !== 'legacy-window-v1') return null;
  const observation = classifyWindow({ ...value.evidence.result, generation: value.generation, sequence: value.sequence, date: value.date, origin: value.origin,
    route: value.route, injected: value.injected, conflicted: value.conflicted });
  return observation ? { ...observation, id: `${value.generation}:t${value.transaction}` } : null;
}

function classifyWindow(candidate: WindowEvidenceResult & Pick<ObserverCandidate, 'generation' | 'sequence' | 'date' | 'origin' | 'route' | 'injected' | 'conflicted'>): Observation | null {
  if (!validDate(candidate.date) || !Number.isSafeInteger(candidate.sequence) || candidate.sequence < 1 ||
      !['ordinary-window', 'chrome', 'obsidian', 'code', 'chatgpt'].includes(candidate.app) ||
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
          !route(['max-button', 'caption-double-click', 'caption-top-drag'], ['win-up'])) return null;
      if (candidate.route === 'caption-top-drag' && (candidate.before.arranged !== false ||
          !candidate.fromMonitor || !candidate.toMonitor || !sameMonitor(candidate.fromMonitor, candidate.toMonitor))) return null;
      operation = 'W03'; shortcut = candidate.before.arranged ? null : 'Win + ↑'; break;
    case 'minimize':
      if (!['normal', 'maximized'].includes(candidate.before.state) || candidate.after.state !== 'minimized' ||
          !route(['min-button'], ['win-down'])) return null;
      shortcut = candidate.before.arranged === false
        ? candidate.before.state === 'maximized' ? 'Win + ↓（必要に応じて繰り返す）' : 'Win + ↓' : null;
      if (candidate.origin === 'key' && shortcut === null) return null;
      operation = 'W04'; break;
    case 'restore':
      if (candidate.before.state !== 'maximized' || candidate.after.state !== 'normal' || candidate.afterArranged !== false ||
          !route(['max-button', 'caption-double-click'], ['win-down'])) return null;
      operation = 'W04'; shortcut = 'Win + ↓'; break;
    case 'close':
      if (!['normal', 'maximized'].includes(candidate.before.state) || candidate.after.state !== 'closed' ||
          !route(['close-button'], ['alt-f4'])) return null;
      operation = 'W11'; shortcut = 'Alt + F4'; break;
    case 'monitor-move': {
      const from = candidate.fromMonitor, to = candidate.toMonitor;
      if (candidate.moveConfirmed !== true || !from || !to || sameMonitor(from, to) || candidate.before.state === 'minimized' ||
          (candidate.origin === 'mouse' && (candidate.after.state !== 'normal' || candidate.afterArranged !== false)) ||
          !['normal', 'maximized'].includes(candidate.before.state) || !['normal', 'maximized'].includes(candidate.after.state) ||
          !route(['caption-drag'], ['win-shift-left', 'win-shift-right'])) return null;
      const direction = candidate.moveDirection;
      if (direction !== undefined && direction !== null && direction !== 'left' && direction !== 'right') return null;
      const equivalent = direction && from.y === to.y && (direction === 'left' ? to.x + to.width <= from.x : from.x + from.width <= to.x) &&
        (candidate.origin !== 'key' || candidate.route === `win-shift-${direction}`);
      operation = 'W02'; shortcut = equivalent ? `Win + Shift + ${direction === 'left' ? '←' : '→'}` :
        candidate.twoDisplayLayoutConfirmed === true && separateMonitors(from, to)
          ? `Win + Shift + ${candidate.origin === 'key' && candidate.route === 'win-shift-right' ? '→' : '←'}` : null;
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

// Two endpoint bounds alone do not prove a complete two-display layout.
function separateMonitors(a: Bounds, b: Bounds): boolean {
  return [a, b].every(r => [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0) &&
    (a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}
