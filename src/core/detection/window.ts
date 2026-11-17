import type {
  WindowEvidenceResult,
  Bounds,
  ObserverCandidate,
  Observation,
} from "../../shared/coach.ts";
import { validDate } from "../dates.ts";
import { sameMonitor, separateMonitors } from "../monitor-geometry.ts";
import type { EvidenceCandidate } from "./types.ts";

export function classifyWindow(
  value: EvidenceCandidate<"window">,
): Observation | null {
  if (value.evidence.profile !== "legacy-window-v1") return null;
  const observation = classifyWindowResult({
    ...value.evidence.result,
    generation: value.generation,
    sequence: value.sequence,
    date: value.date,
    origin: value.origin,
    route: value.route,
    injected: value.injected,
    conflicted: value.conflicted,
  });
  return observation
    ? { ...observation, id: `${value.generation}:t${value.transaction}` }
    : null;
}

type WindowCandidate = WindowEvidenceResult &
  Pick<
    ObserverCandidate,
    | "generation"
    | "sequence"
    | "date"
    | "origin"
    | "route"
    | "injected"
    | "conflicted"
  >;
type ClassifiedWindow = Pick<Observation, "operation" | "shortcut">;

function classifyWindowResult(candidate: WindowCandidate): Observation | null {
  if (invalidWindowIdentity(candidate)) return null;
  if (invalidWindowInput(candidate)) return null;
  if (invalidWindowTiming(candidate)) return null;
  const result = windowOperation(candidate);
  if (!result) return null;
  return {
    id: `${candidate.generation}:${candidate.sequence}`,
    ...result,
    origin: candidate.origin === "key" ? "key" : "mouse",
    date: candidate.date,
    monitor: candidate.monitor,
  };
}

function windowOperation(candidate: WindowCandidate): ClassifiedWindow | null {
  switch (candidate.operation) {
    case "maximize":
      return maximizeWindow(candidate);
    case "minimize":
      return minimizeWindow(candidate);
    case "restore":
      return restoreWindow(candidate);
    case "close":
      return closeWindow(candidate);
    case "monitor-move":
      return moveWindow(candidate);
    default:
      return null;
  }
}
function matchesRoute(
  candidate: WindowCandidate,
  mouse: string[],
  key: string[],
): boolean {
  return candidate.origin === "mouse"
    ? mouse.includes(candidate.route)
    : key.includes(candidate.route);
}

function maximizeWindow(candidate: WindowCandidate): ClassifiedWindow | null {
  if (invalidMaximizeStart(candidate)) return null;
  if (
    !matchesRoute(
      candidate,
      [
        "max-button",
        "caption-double-click",
        "caption-top-drag",
        "mouse-state-fallback",
      ],
      ["win-up"],
    )
  )
    return null;
  if (invalidMaximizeDrag(candidate)) return null;
  // Representative maximize key, not a promise to reproduce the initial snap layout.
  return { operation: "W03", shortcut: "Win + ↑" };
}

function minimizeWindow(candidate: WindowCandidate): ClassifiedWindow | null {
  let operation: Observation["operation"];
  let shortcut: string | null;
  if (!["normal", "maximized"].includes(candidate.before.state)) return null;
  if (candidate.after.state !== "minimized") return null;
  if (
    !matchesRoute(
      candidate,
      ["min-button", "mouse-state-fallback"],
      ["win-down"],
    )
  )
    return null;
  shortcut = candidate.before.arranged === false ? "Win + ↓" : null;
  if (candidate.origin === "key" && shortcut === null) return null;
  operation = "W04";
  return { operation, shortcut };
}

function restoreWindow(candidate: WindowCandidate): ClassifiedWindow | null {
  if (candidate.before.state !== "maximized") return null;
  if (candidate.after.state !== "normal") return null;
  if (candidate.afterArranged !== false) return null;
  if (
    !matchesRoute(
      candidate,
      ["max-button", "caption-double-click", "mouse-state-fallback"],
      ["win-down"],
    )
  )
    return null;
  return { operation: "W04", shortcut: "Win + ↓" };
}

function closeWindow(candidate: WindowCandidate): ClassifiedWindow | null {
  if (!["normal", "maximized"].includes(candidate.before.state)) return null;
  if (candidate.after.state !== "closed") return null;
  if (!matchesRoute(candidate, ["close-button"], ["alt-f4"])) return null;
  return { operation: "W11", shortcut: "Alt + F4" };
}

function moveWindow(candidate: WindowCandidate): ClassifiedWindow | null {
  let operation: Observation["operation"];
  let shortcut: string | null;
  const from = candidate.fromMonitor,
    to = candidate.toMonitor;
  if (candidate.moveConfirmed !== true) return null;
  if (!from) return null;
  if (!to) return null;
  if (sameMonitor(from, to)) return null;
  if (invalidMoveStates(candidate)) return null;
  if (
    !matchesRoute(
      candidate,
      ["caption-drag"],
      ["win-shift-left", "win-shift-right"],
    )
  )
    return null;
  if (invalidMoveDirection(candidate.moveDirection)) return null;
  operation = "W02";
  shortcut = moveShortcut(candidate, from, to);
  return { operation, shortcut };
}

function invalidWindowIdentity(candidate: WindowCandidate): boolean {
  return (
    invalidWindowSequenceDate(candidate) || !supportedWindowApp(candidate.app)
  );
}
function invalidWindowSequenceDate(candidate: WindowCandidate): boolean {
  return (
    !validDate(candidate.date) ||
    !Number.isSafeInteger(candidate.sequence) ||
    candidate.sequence < 1
  );
}
function supportedWindowApp(app: string): boolean {
  return ["ordinary-window", "chrome", "obsidian", "code", "chatgpt"].includes(
    app,
  );
}
function invalidWindowInput(candidate: WindowCandidate): boolean {
  return (
    unsafeWindowActivity(candidate) ||
    uncertainWindowTarget(candidate) ||
    !["mouse", "key"].includes(candidate.origin)
  );
}
function unsafeWindowActivity(candidate: WindowCandidate): boolean {
  return candidate.injected || candidate.conflicted || candidate.moving;
}
function uncertainWindowTarget(candidate: WindowCandidate): boolean {
  return candidate.elevated !== false || !candidate.targetMatched;
}
function invalidWindowTiming(candidate: WindowCandidate): boolean {
  return (
    candidate.inputAgeMs < 0 ||
    candidate.inputAgeMs > 1000 ||
    (candidate.route === "mouse-state-fallback" && candidate.inputAgeMs > 500)
  );
}
function maximizedMove(candidate: WindowCandidate): boolean {
  return (
    candidate.before.state === "maximized" &&
    candidate.after.state === "maximized"
  );
}
function invalidMouseMoveTerminal(candidate: WindowCandidate): boolean {
  return (
    candidate.origin === "mouse" &&
    !maximizedMove(candidate) &&
    (candidate.after.state !== "normal" || candidate.afterArranged !== false)
  );
}
function invalidMoveStates(candidate: WindowCandidate): boolean {
  return (
    candidate.before.state === "minimized" ||
    invalidMouseMoveTerminal(candidate) ||
    !["normal", "maximized"].includes(candidate.before.state) ||
    !["normal", "maximized"].includes(candidate.after.state)
  );
}
function invalidMoveDirection(
  direction: WindowCandidate["moveDirection"],
): boolean {
  return ![undefined, null, "left", "right"].includes(direction);
}
function moveDirectionEquivalent(
  candidate: WindowCandidate,
  from: Bounds,
  to: Bounds,
): boolean {
  const direction = candidate.moveDirection;
  const routeMatches =
    candidate.origin !== "key" || candidate.route === `win-shift-${direction}`;
  return (
    !!direction &&
    from.y === to.y &&
    directionGeometry(direction, from, to) &&
    routeMatches
  );
}
function directionGeometry(
  direction: "left" | "right",
  from: Bounds,
  to: Bounds,
): boolean {
  return direction === "left"
    ? to.x + to.width <= from.x
    : from.x + from.width <= to.x;
}
function moveShortcut(
  candidate: WindowCandidate,
  from: Bounds,
  to: Bounds,
): string | null {
  if (moveDirectionEquivalent(candidate, from, to))
    return `Win + Shift + ${candidate.moveDirection === "left" ? "←" : "→"}`;
  if (candidate.twoDisplayLayoutConfirmed !== true) return null;
  if (!separateMonitors(from, to)) return null;
  return `Win + Shift + ${candidate.origin === "key" && candidate.route === "win-shift-right" ? "→" : "←"}`;
}
function invalidMaximizeStart(candidate: WindowCandidate): boolean {
  return (
    candidate.before.state !== "normal" ||
    (candidate.before.arranged === null && candidate.origin !== "key") ||
    candidate.after.state !== "maximized"
  );
}
function invalidMaximizeDrag(candidate: WindowCandidate): boolean {
  return (
    candidate.route === "caption-top-drag" &&
    (!candidate.fromMonitor ||
      !candidate.toMonitor ||
      !sameMonitor(candidate.fromMonitor, candidate.toMonitor))
  );
}
