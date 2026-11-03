import type { ObserverCandidate } from '../shared/coach.ts';

export const finalDiagnosticKeys = [
  'kind-window', 'kind-placement', 'kind-compound', 'kind-close', 'kind-switch', 'kind-taskbar', 'kind-snap', 'kind-other',
  'origin-mouse', 'origin-key', 'origin-unknown', 'injected', 'conflicted',
  'route-max-button', 'route-min-button', 'route-caption-double-click', 'route-caption-top-drag', 'route-caption-drag',
  'route-win-up', 'route-win-down', 'route-mouse-state-fallback', 'route-unknown', 'route-other',
  'operation-maximize', 'operation-restore', 'operation-minimize', 'operation-other',
  'before-normal', 'before-maximized', 'before-minimized', 'before-other',
  'after-normal', 'after-maximized', 'after-minimized', 'after-other',
  'before-arranged-true', 'before-arranged-false', 'before-arranged-unknown',
  'after-arranged-true', 'after-arranged-false', 'after-arranged-unknown',
  'input-recent', 'input-old', 'input-invalid', 'target-unmatched', 'moving', 'elevated',
  'same-monitor', 'different-monitor', 'monitor-unknown', 'app-category-known', 'app-category-unknown'
] as const;
export type FinalDiagnosticKey = typeof finalDiagnosticKeys[number];
const lookup = (values: Record<string, FinalDiagnosticKey>, value: string, fallback: FinalDiagnosticKey): FinalDiagnosticKey =>
  Object.hasOwn(values, value) ? values[value] : fallback;

// Bounded categories only; never retain raw evidence, routes, process names, geometry or input timing.
export function finalCandidateDiagnostics(value: ObserverCandidate): FinalDiagnosticKey[] {
  const keys: FinalDiagnosticKey[] = [];
  const kinds: Record<string, FinalDiagnosticKey> = { window: 'kind-window', placement: 'kind-placement', 'compound-drag': 'kind-compound',
    'window-close': 'kind-close', 'window-switch': 'kind-switch', 'taskbar-input': 'kind-taskbar', 'snap-invocation': 'kind-snap' };
  keys.push(lookup(kinds, value.evidence.kind, 'kind-other'), value.origin === 'mouse' ? 'origin-mouse' : value.origin === 'key' ? 'origin-key' : 'origin-unknown');
  if (value.injected) keys.push('injected'); if (value.conflicted) keys.push('conflicted');
  const routes: Record<string, FinalDiagnosticKey> = { 'max-button': 'route-max-button', 'min-button': 'route-min-button',
    'caption-double-click': 'route-caption-double-click', 'caption-top-drag': 'route-caption-top-drag', 'caption-drag': 'route-caption-drag',
    'win-up': 'route-win-up', 'win-down': 'route-win-down', 'mouse-state-fallback': 'route-mouse-state-fallback', unknown: 'route-unknown' };
  keys.push(lookup(routes, value.route, 'route-other'));
  if (value.evidence.kind !== 'window') return keys;
  const e = value.evidence.result;
  const ops: Record<string, FinalDiagnosticKey> = { maximize: 'operation-maximize', restore: 'operation-restore', minimize: 'operation-minimize' };
  keys.push(lookup(ops, e.operation, 'operation-other'));
  keys.push(e.before.state === 'normal' ? 'before-normal' : e.before.state === 'maximized' ? 'before-maximized' : e.before.state === 'minimized' ? 'before-minimized' : 'before-other');
  keys.push(e.after.state === 'normal' ? 'after-normal' : e.after.state === 'maximized' ? 'after-maximized' : e.after.state === 'minimized' ? 'after-minimized' : 'after-other');
  keys.push(e.before.arranged === true ? 'before-arranged-true' : e.before.arranged === false ? 'before-arranged-false' : 'before-arranged-unknown');
  keys.push(e.afterArranged === true ? 'after-arranged-true' : e.afterArranged === false ? 'after-arranged-false' : 'after-arranged-unknown');
  keys.push(!Number.isFinite(e.inputAgeMs) || e.inputAgeMs < 0 ? 'input-invalid' : e.inputAgeMs <= 1000 ? 'input-recent' : 'input-old');
  if (!e.targetMatched) keys.push('target-unmatched'); if (e.moving) keys.push('moving'); if (e.elevated) keys.push('elevated');
  const from = e.fromMonitor, to = e.toMonitor;
  keys.push(!from || !to ? 'monitor-unknown' : from.x === to.x && from.y === to.y && from.width === to.width && from.height === to.height ? 'same-monitor' : 'different-monitor');
  keys.push(['ordinary-window', 'chrome', 'obsidian', 'code', 'chatgpt'].includes(e.app) ? 'app-category-known' : 'app-category-unknown');
  return keys;
}
