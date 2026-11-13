import { validDate } from "../core/dates.ts";
import type { Bounds, CandidateV2, IndependentProof } from "../shared/coach.ts";

type ObjectValue = Record<string, unknown>;
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
function bounds(value: unknown): value is Bounds {
  return (
    object(value) &&
    keys(value, "x y width height") &&
    [value.x, value.y, value.width, value.height].every(
      (n) => typeof n === "number" && Number.isFinite(n),
    ) &&
    typeof value.width === "number" &&
    value.width > 0 &&
    typeof value.height === "number" &&
    value.height > 0
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

function proof(
  value: unknown,
  origin: "mouse" | "key",
): value is IndependentProof {
  if (!object(value)) return false;
  const mouse = origin === "mouse";
  switch (value.kind) {
    case "switch":
      return (
        keys(
          value,
          "kind route windowsDifferent eligible foregroundMatched inputAgeMs settleMs monitor",
        ) &&
        value.route === (mouse ? "direct-click" : "alt-tab") &&
        value.windowsDifferent === true &&
        value.eligible === true &&
        value.foregroundMatched === true &&
        integer(value.inputAgeMs, mouse ? 1500 : 15000) &&
        integer(value.settleMs, mouse ? 1500 : 2000, mouse ? 0 : 250) &&
        value.settleMs <= value.inputAgeMs &&
        nullableBounds(value.monitor)
      );
    case "monitor-move": {
      if (
        !keys(
          value,
          "kind route moveConfirmed layoutStable inputAgeMs fromMonitor toMonitor moveDirection twoDisplayLayoutConfirmed",
        ) ||
        !(mouse
          ? value.route === "caption-drag"
          : oneOf(value.route, "win-shift-left win-shift-right")) ||
        value.moveConfirmed !== true ||
        value.layoutStable !== true ||
        !integer(value.inputAgeMs, 1000) ||
        !bounds(value.fromMonitor) ||
        !bounds(value.toMonitor) ||
        !(
          value.moveDirection === null ||
          oneOf(value.moveDirection, "left right")
        ) ||
        typeof value.twoDisplayLayoutConfirmed !== "boolean"
      )
        return false;
      const from = value.fromMonitor,
        to = value.toMonitor;
      return !(
        from.x === to.x &&
        from.y === to.y &&
        from.width === to.width &&
        from.height === to.height
      );
    }
    case "state": {
      if (
        !keys(
          value,
          "kind route action before after beforeArranged afterArranged inputAgeMs monitor",
        ) ||
        !oneOf(value.before, "normal maximized") ||
        !nullableBoolean(value.beforeArranged) ||
        !nullableBoolean(value.afterArranged) ||
        !integer(
          value.inputAgeMs,
          value.route === "mouse-state-fallback" ? 500 : 1000,
        ) ||
        !nullableBounds(value.monitor)
      )
        return false;
      switch (value.action) {
        case "maximize":
          return (
            value.before === "normal" &&
            value.after === "maximized" &&
            (mouse
              ? oneOf(
                  value.route,
                  "max-button caption-double-click caption-top-drag mouse-state-fallback",
                ) && value.beforeArranged !== null
              : value.route === "win-up")
          );
        case "restore":
          return (
            value.before === "maximized" &&
            value.after === "normal" &&
            value.afterArranged === false &&
            (mouse
              ? oneOf(
                  value.route,
                  "max-button caption-double-click mouse-state-fallback",
                )
              : value.route === "win-down")
          );
        case "minimize":
          return (
            value.after === "minimized" &&
            (mouse
              ? oneOf(value.route, "min-button mouse-state-fallback")
              : value.route === "win-down" && value.beforeArranged === false)
          );
        default:
          return false;
      }
    }
    case "placement":
      return (
        keys(
          value,
          "kind route shape placementConfirmed layoutStable inputAgeMs monitor",
        ) &&
        value.route === (mouse ? "caption-edge-drag" : "win-held-arrows") &&
        oneOf(
          value.shape,
          "left-half right-half left-top right-top left-bottom right-bottom",
        ) &&
        value.placementConfirmed === true &&
        value.layoutStable === true &&
        integer(value.inputAgeMs, mouse ? 1000 : 15000) &&
        bounds(value.monitor)
      );
    case "close":
      return (
        keys(value, "kind route destroyed inputAgeMs monitor") &&
        value.route === (mouse ? "close-button" : "alt-f4") &&
        value.destroyed === true &&
        integer(value.inputAgeMs, 1000) &&
        nullableBounds(value.monitor)
      );
    case "taskbar":
      return (
        keys(
          value,
          "kind route slot mappingConfirmed snapshotAgeMs confirmationAgeMs monitor",
        ) &&
        value.route === (mouse ? "taskbar-click" : "win-digit") &&
        integer(value.slot, 10, 1) &&
        value.mappingConfirmed === true &&
        integer(value.snapshotAgeMs, 750) &&
        integer(value.confirmationAgeMs, 2500) &&
        nullableBounds(value.monitor)
      );
    default:
      return false;
  }
}

// Proof categories are transport semantics, independent of product operation IDs.
function category(value: IndependentProof): number {
  switch (value.kind) {
    case "switch":
      return 0;
    case "monitor-move":
      return 1;
    case "state":
      return value.action === "maximize" ? 2 : 3;
    case "placement":
      return value.shape.endsWith("half") ? 4 : 5;
    case "close":
      return 6;
    case "taskbar":
      return 7;
  }
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

export function independentCandidate(value: ObjectValue): CandidateV2 | null {
  if (
    !keys(
      value,
      "type protocolVersion generation sequence transaction date origin route injected conflicted evidence",
    ) ||
    value.type !== "candidate" ||
    value.protocolVersion !== 2 ||
    !integer(value.generation, 0x7fffffff, 1) ||
    !integer(value.sequence, 0x7fffffff, 1) ||
    !integer(value.transaction, 0x7fffffff, 1) ||
    typeof value.date !== "string" ||
    !validDate(value.date) ||
    !(value.origin === "mouse" || value.origin === "key") ||
    value.route !== "independent-results" ||
    value.injected !== false ||
    value.conflicted !== false ||
    !object(value.evidence)
  )
    return null;
  const evidence = value.evidence;
  if (
    !keys(evidence, "kind profile targetMatched released final results") ||
    evidence.kind !== "independent-results" ||
    evidence.profile !== "independent-results-v1" ||
    evidence.targetMatched !== true ||
    evidence.released !== true ||
    evidence.final !== true ||
    !Array.isArray(evidence.results) ||
    evidence.results.length === 0
  )
    return null;
  const results = new Map<number, IndependentProof>();
  for (const result of evidence.results) {
    if (!proof(result, value.origin)) return null;
    const key = category(result),
      previous = results.get(key);
    if (previous && canonical(previous) !== canonical(result)) return null;
    results.set(key, result);
  }
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
      results: [...results.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, result]) => result),
    },
  };
}
