import type {
  WindowEvidenceResult,
  ObserverCandidate,
  Observation,
  OperationId,
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

function classifyWindowResult(
  candidate: WindowEvidenceResult &
    Pick<
      ObserverCandidate,
      | "generation"
      | "sequence"
      | "date"
      | "origin"
      | "route"
      | "injected"
      | "conflicted"
    >,
): Observation | null {
  if (
    !validDate(candidate.date) ||
    !Number.isSafeInteger(candidate.sequence) ||
    candidate.sequence < 1 ||
    !["ordinary-window", "chrome", "obsidian", "code", "chatgpt"].includes(
      candidate.app,
    ) ||
    candidate.elevated !== false ||
    candidate.injected ||
    candidate.conflicted ||
    candidate.moving ||
    !candidate.targetMatched ||
    candidate.inputAgeMs < 0 ||
    candidate.inputAgeMs > 1000 ||
    (candidate.route === "mouse-state-fallback" &&
      candidate.inputAgeMs > 500) ||
    !["mouse", "key"].includes(candidate.origin)
  )
    return null;
  let operation: OperationId;
  let shortcut: string | null;
  const route = (mouse: string[], key: string[]) =>
    candidate.origin === "mouse"
      ? mouse.includes(candidate.route)
      : key.includes(candidate.route);
  switch (candidate.operation) {
    case "maximize":
      if (
        candidate.before.state !== "normal" ||
        (candidate.before.arranged === null && candidate.origin !== "key") ||
        candidate.after.state !== "maximized" ||
        !route(
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
      if (
        candidate.route === "caption-top-drag" &&
        (!candidate.fromMonitor ||
          !candidate.toMonitor ||
          !sameMonitor(candidate.fromMonitor, candidate.toMonitor))
      )
        return null;
      operation = "W03";
      // Representative maximize key, not a promise to reproduce the initial snap layout.
      shortcut = "Win + ↑";
      break;
    case "minimize":
      if (
        !["normal", "maximized"].includes(candidate.before.state) ||
        candidate.after.state !== "minimized" ||
        !route(["min-button", "mouse-state-fallback"], ["win-down"])
      )
        return null;
      shortcut = candidate.before.arranged === false ? "Win + ↓" : null;
      if (candidate.origin === "key" && shortcut === null) return null;
      operation = "W04";
      break;
    case "restore":
      if (
        candidate.before.state !== "maximized" ||
        candidate.after.state !== "normal" ||
        candidate.afterArranged !== false ||
        !route(
          ["max-button", "caption-double-click", "mouse-state-fallback"],
          ["win-down"],
        )
      )
        return null;
      operation = "W04";
      shortcut = "Win + ↓";
      break;
    case "close":
      if (
        !["normal", "maximized"].includes(candidate.before.state) ||
        candidate.after.state !== "closed" ||
        !route(["close-button"], ["alt-f4"])
      )
        return null;
      operation = "W11";
      shortcut = "Alt + F4";
      break;
    case "monitor-move": {
      const from = candidate.fromMonitor,
        to = candidate.toMonitor;
      if (
        candidate.moveConfirmed !== true ||
        !from ||
        !to ||
        sameMonitor(from, to) ||
        candidate.before.state === "minimized" ||
        (candidate.origin === "mouse" &&
          !(
            candidate.before.state === "maximized" &&
            candidate.after.state === "maximized"
          ) &&
          (candidate.after.state !== "normal" ||
            candidate.afterArranged !== false)) ||
        !["normal", "maximized"].includes(candidate.before.state) ||
        !["normal", "maximized"].includes(candidate.after.state) ||
        !route(["caption-drag"], ["win-shift-left", "win-shift-right"])
      )
        return null;
      const direction = candidate.moveDirection;
      if (
        direction !== undefined &&
        direction !== null &&
        direction !== "left" &&
        direction !== "right"
      )
        return null;
      const equivalent =
        direction &&
        from.y === to.y &&
        (direction === "left"
          ? to.x + to.width <= from.x
          : from.x + from.width <= to.x) &&
        (candidate.origin !== "key" ||
          candidate.route === `win-shift-${direction}`);
      operation = "W02";
      shortcut = equivalent
        ? `Win + Shift + ${direction === "left" ? "←" : "→"}`
        : candidate.twoDisplayLayoutConfirmed === true &&
            separateMonitors(from, to)
          ? `Win + Shift + ${candidate.origin === "key" && candidate.route === "win-shift-right" ? "→" : "←"}`
          : null;
      break;
    }
    default:
      return null;
  }
  return {
    id: `${candidate.generation}:${candidate.sequence}`,
    operation,
    origin: candidate.origin === "key" ? "key" : "mouse",
    date: candidate.date,
    shortcut,
    monitor: candidate.monitor,
  };
}
