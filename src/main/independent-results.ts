import { validDate } from "../core/dates.ts";
import type {
  Bounds,
  CandidateV2,
  IndependentProof,
  IndependentResultsEvidence,
} from "../shared/coach.ts";

type ObjectValue = Record<string, unknown>;
type Origin = "mouse" | "key";
function object(value: unknown): value is ObjectValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: ObjectValue, names: string): boolean {
  const expected = names.split(" ");
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
function integer(value: unknown, max: number, min = 0): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}
function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function bounds(value: unknown): value is Bounds {
  if (!object(value) || !keys(value, "x y width height")) return false;
  const coordinates = [value.x, value.y].every(
    (n) => typeof n === "number" && Number.isFinite(n),
  );
  return (
    coordinates && positiveFinite(value.width) && positiveFinite(value.height)
  );
}
function nullableBounds(value: unknown): boolean {
  return value === null || bounds(value);
}
function nullableBoolean(value: unknown): boolean {
  return value === null || typeof value === "boolean";
}
function oneOf(value: unknown, options: string): boolean {
  return typeof value === "string" && options.split(" ").includes(value);
}
function confirmed(value: ObjectValue, names: string): boolean {
  return names.split(" ").every((name) => value[name] === true);
}
function originRoute(
  route: unknown,
  origin: Origin,
  mouseRoutes: string,
  keyRoutes: string,
): boolean {
  return oneOf(route, origin === "mouse" ? mouseRoutes : keyRoutes);
}

function switchTiming(value: ObjectValue, origin: Origin): boolean {
  const mouse = origin === "mouse";
  return (
    integer(value.inputAgeMs, mouse ? 1500 : 15000) &&
    integer(value.settleMs, mouse ? 1500 : 2000, mouse ? 0 : 250) &&
    value.settleMs <= value.inputAgeMs
  );
}
function switchProof(value: ObjectValue, origin: Origin): boolean {
  return (
    keys(
      value,
      "kind route windowsDifferent eligible foregroundMatched inputAgeMs settleMs monitor",
    ) &&
    originRoute(value.route, origin, "direct-click", "alt-tab") &&
    confirmed(value, "windowsDifferent eligible foregroundMatched") &&
    switchTiming(value, origin) &&
    nullableBounds(value.monitor)
  );
}
function differentMonitors(from: Bounds, to: Bounds): boolean {
  return (
    from.x !== to.x ||
    from.y !== to.y ||
    from.width !== to.width ||
    from.height !== to.height
  );
}
function monitorMoveGeometry(value: ObjectValue): boolean {
  return (
    bounds(value.fromMonitor) &&
    bounds(value.toMonitor) &&
    differentMonitors(value.fromMonitor, value.toMonitor)
  );
}
function monitorMoveDirection(value: ObjectValue): boolean {
  return (
    (value.moveDirection === null ||
      oneOf(value.moveDirection, "left right")) &&
    typeof value.twoDisplayLayoutConfirmed === "boolean"
  );
}
function monitorMoveProof(value: ObjectValue, origin: Origin): boolean {
  return (
    keys(
      value,
      "kind route moveConfirmed layoutStable inputAgeMs fromMonitor toMonitor moveDirection twoDisplayLayoutConfirmed",
    ) &&
    originRoute(
      value.route,
      origin,
      "caption-drag",
      "win-shift-left win-shift-right",
    ) &&
    confirmed(value, "moveConfirmed layoutStable") &&
    integer(value.inputAgeMs, 1000) &&
    monitorMoveGeometry(value) &&
    monitorMoveDirection(value)
  );
}
function stateFields(value: ObjectValue): boolean {
  return (
    keys(
      value,
      "kind route action before after beforeArranged afterArranged inputAgeMs monitor",
    ) &&
    oneOf(value.before, "normal maximized") &&
    nullableBoolean(value.beforeArranged) &&
    nullableBoolean(value.afterArranged) &&
    integer(
      value.inputAgeMs,
      value.route === "mouse-state-fallback" ? 500 : 1000,
    ) &&
    nullableBounds(value.monitor)
  );
}
function maximizeState(value: ObjectValue, origin: Origin): boolean {
  const inputValid = originRoute(
    value.route,
    origin,
    "max-button caption-double-click caption-top-drag mouse-state-fallback",
    "win-up",
  );
  const startKnown = origin !== "mouse" || value.beforeArranged !== null;
  return (
    value.before === "normal" &&
    value.after === "maximized" &&
    inputValid &&
    startKnown
  );
}
function restoreState(value: ObjectValue, origin: Origin): boolean {
  return (
    value.before === "maximized" &&
    value.after === "normal" &&
    value.afterArranged === false &&
    originRoute(
      value.route,
      origin,
      "max-button caption-double-click mouse-state-fallback",
      "win-down",
    )
  );
}
function minimizeState(value: ObjectValue, origin: Origin): boolean {
  const startValid = origin !== "key" || value.beforeArranged === false;
  return (
    value.after === "minimized" &&
    startValid &&
    originRoute(
      value.route,
      origin,
      "min-button mouse-state-fallback",
      "win-down",
    )
  );
}
function stateProof(value: ObjectValue, origin: Origin): boolean {
  if (!stateFields(value)) return false;
  switch (value.action) {
    case "maximize":
      return maximizeState(value, origin);
    case "restore":
      return restoreState(value, origin);
    case "minimize":
      return minimizeState(value, origin);
    default:
      return false;
  }
}
function placementProof(value: ObjectValue, origin: Origin): boolean {
  return (
    keys(
      value,
      "kind route shape placementConfirmed layoutStable inputAgeMs monitor",
    ) &&
    originRoute(value.route, origin, "caption-edge-drag", "win-held-arrows") &&
    oneOf(
      value.shape,
      "left-half right-half left-top right-top left-bottom right-bottom",
    ) &&
    confirmed(value, "placementConfirmed layoutStable") &&
    integer(value.inputAgeMs, origin === "mouse" ? 1000 : 15000) &&
    bounds(value.monitor)
  );
}
function closeProof(value: ObjectValue, origin: Origin): boolean {
  return (
    keys(value, "kind route destroyed inputAgeMs monitor") &&
    originRoute(value.route, origin, "close-button", "alt-f4") &&
    value.destroyed === true &&
    integer(value.inputAgeMs, 1000) &&
    nullableBounds(value.monitor)
  );
}
function taskbarProof(value: ObjectValue, origin: Origin): boolean {
  return (
    keys(
      value,
      "kind route slot mappingConfirmed snapshotAgeMs confirmationAgeMs monitor",
    ) &&
    originRoute(value.route, origin, "taskbar-click", "win-digit") &&
    integer(value.slot, 10, 1) &&
    value.mappingConfirmed === true &&
    integer(value.snapshotAgeMs, 750) &&
    integer(value.confirmationAgeMs, 2500) &&
    nullableBounds(value.monitor)
  );
}
function proof(value: unknown, origin: Origin): value is IndependentProof {
  if (!object(value)) return false;
  switch (value.kind) {
    case "switch":
      return switchProof(value, origin);
    case "monitor-move":
      return monitorMoveProof(value, origin);
    case "state":
      return stateProof(value, origin);
    case "placement":
      return placementProof(value, origin);
    case "close":
      return closeProof(value, origin);
    case "taskbar":
      return taskbarProof(value, origin);
    default:
      return false;
  }
}

// Categories keep transport normalization independent of product operation IDs.
const simpleCategories = {
  switch: 0,
  "monitor-move": 1,
  close: 6,
  taskbar: 7,
} as const;
function category(value: IndependentProof): number {
  if (value.kind === "state") return value.action === "maximize" ? 2 : 3;
  if (value.kind === "placement") return value.shape.endsWith("half") ? 4 : 5;
  return simpleCategories[value.kind];
}
function canonical(value: unknown): string {
  if (!object(value)) return JSON.stringify(value);
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
      .join(",") +
    "}"
  );
}
function normalizeProofs(
  values: unknown[],
  origin: Origin,
): IndependentProof[] | null {
  const results = new Map<number, IndependentProof>();
  for (const result of values) {
    if (!proof(result, origin)) return null;
    const key = category(result),
      previous = results.get(key);
    if (previous && canonical(previous) !== canonical(result)) return null;
    results.set(key, result);
  }
  return [...results.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, result]) => result);
}
function candidateIdentity(value: ObjectValue): boolean {
  return (
    value.type === "candidate" &&
    value.protocolVersion === 2 &&
    [value.generation, value.sequence, value.transaction].every((id) =>
      integer(id, 0x7fffffff, 1),
    ) &&
    typeof value.date === "string" &&
    validDate(value.date)
  );
}
function candidateInput(value: ObjectValue): boolean {
  return (
    oneOf(value.origin, "mouse key") &&
    value.route === "independent-results" &&
    value.injected === false &&
    value.conflicted === false
  );
}
function candidateHeader(value: ObjectValue): value is Omit<
  CandidateV2,
  "evidence" | "origin"
> & {
  origin: Origin;
  evidence: unknown;
} {
  return (
    keys(
      value,
      "type protocolVersion generation sequence transaction date origin route injected conflicted evidence",
    ) &&
    candidateIdentity(value) &&
    candidateInput(value)
  );
}
function completedEvidence(value: unknown): value is Omit<
  IndependentResultsEvidence,
  "results"
> & {
  results: unknown[];
} {
  if (!object(value)) return false;
  return (
    keys(value, "kind profile targetMatched released final results") &&
    value.kind === "independent-results" &&
    value.profile === "independent-results-v1" &&
    confirmed(value, "targetMatched released final") &&
    Array.isArray(value.results) &&
    value.results.length > 0
  );
}
export function independentCandidate(value: ObjectValue): CandidateV2 | null {
  if (!candidateHeader(value) || !completedEvidence(value.evidence))
    return null;
  const results = normalizeProofs(value.evidence.results, value.origin);
  if (!results) return null;
  return {
    type: "candidate",
    protocolVersion: 2,
    generation: value.generation,
    sequence: value.sequence,
    transaction: value.transaction,
    date: value.date,
    origin: value.origin,
    route: "independent-results",
    injected: false,
    conflicted: false,
    evidence: {
      kind: "independent-results",
      profile: "independent-results-v1",
      targetMatched: true,
      released: true,
      final: true,
      results,
    },
  };
}

export function usesIndependentResults(value: ObjectValue): boolean {
  if (value.route === "independent-results") return true;
  if (!object(value.evidence)) return false;
  return (
    value.evidence.kind === "independent-results" ||
    value.evidence.profile === "independent-results-v1"
  );
}
