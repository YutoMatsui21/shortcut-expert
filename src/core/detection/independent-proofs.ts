import type { IndependentProof, Observation } from "../../shared/coach.ts";
import { separateMonitors } from "../monitor-geometry.ts";
type ClassifiedProof = Pick<Observation, "operation" | "shortcut" | "monitor">;

// Called only after independentCandidate validates and normalizes the full envelope.
export function classifyProof(
  proof: IndependentProof,
  origin: "mouse" | "key",
): Pick<Observation, "operation" | "shortcut" | "monitor"> {
  switch (proof.kind) {
    case "switch":
      return classifySwitchProof(proof);
    case "monitor-move":
      return classifyMonitorMoveProof(proof, origin);
    case "state":
      return classifyStateProof(proof);
    case "placement":
      return placementObservation(proof);
    case "close":
      return classifyCloseProof(proof);
    case "taskbar":
      return classifyTaskbarProof(proof);
  }
}

type MonitorMoveProof = Extract<IndependentProof, { kind: "monitor-move" }>;
type StateProof = Extract<IndependentProof, { kind: "state" }>;
type PlacementProof = Extract<IndependentProof, { kind: "placement" }>;

function directionMatchesGeometry(proof: MonitorMoveProof): boolean {
  const { fromMonitor: from, toMonitor: to, moveDirection: direction } = proof;
  if (!direction || from.y !== to.y) return false;
  return direction === "left"
    ? to.x + to.width <= from.x
    : from.x + from.width <= to.x;
}

function monitorShortcut(
  proof: MonitorMoveProof,
  origin: "mouse" | "key",
): string | null {
  const routeMatches =
    origin !== "key" || proof.route === `win-shift-${proof.moveDirection}`;
  if (directionMatchesGeometry(proof) && routeMatches)
    return `Win + Shift + ${proof.moveDirection === "left" ? "←" : "→"}`;
  if (
    !proof.twoDisplayLayoutConfirmed ||
    !separateMonitors(proof.fromMonitor, proof.toMonitor)
  )
    return null;
  return representativeMonitorShortcut(proof, origin);
}

function representativeMonitorShortcut(
  proof: MonitorMoveProof,
  origin: "mouse" | "key",
): string {
  return `Win + Shift + ${origin === "key" && proof.route === "win-shift-right" ? "→" : "←"}`;
}

function stateShortcut(proof: StateProof): string | null {
  if (proof.action === "maximize") return "Win + ↑";
  if (proof.action === "restore") return "Win + ↓";
  return hasReductionShortcut(proof) ? "Win + ↓" : null;
}

function hasReductionShortcut(proof: StateProof): boolean {
  return (
    proof.beforeArranged === false ||
    ["inactive-min-button", "inactive-state-fallback"].includes(proof.route)
  );
}

function placementObservation(
  proof: PlacementProof,
): Pick<Observation, "operation" | "shortcut" | "monitor"> {
  const [side, vertical] = proof.shape.split("-");
  const horizontal = side === "left" ? "←" : "→";
  return {
    operation: vertical === "half" ? "W06" : "W07",
    monitor: proof.monitor,
    shortcut:
      vertical === "half"
        ? `Win + ${horizontal}`
        : `Winを押したまま ${horizontal}、続けて ${vertical === "top" ? "↑" : "↓"}`,
  };
}

function classifySwitchProof(
  proof: Extract<IndependentProof, { kind: "switch" }>,
): ClassifiedProof {
  return { operation: "W01", shortcut: "Alt + Tab", monitor: proof.monitor };
}
function classifyMonitorMoveProof(
  proof: MonitorMoveProof,
  origin: "mouse" | "key",
): ClassifiedProof {
  return {
    operation: "W02",
    monitor: proof.toMonitor,
    shortcut: monitorShortcut(proof, origin),
  };
}
function classifyStateProof(proof: StateProof): ClassifiedProof {
  return {
    operation: proof.action === "maximize" ? "W03" : "W04",
    monitor: proof.monitor,
    shortcut: stateShortcut(proof),
  };
}
function classifyCloseProof(
  proof: Extract<IndependentProof, { kind: "close" }>,
): ClassifiedProof {
  return { operation: "W11", shortcut: "Alt + F4", monitor: proof.monitor };
}
function classifyTaskbarProof(
  proof: Extract<IndependentProof, { kind: "taskbar" }>,
): ClassifiedProof {
  return {
    operation: "W12",
    shortcut: `Win + ${proof.slot === 10 ? 0 : proof.slot}`,
    monitor: proof.monitor,
  };
}
