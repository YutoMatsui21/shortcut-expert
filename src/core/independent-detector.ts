import type {
  ObserverCandidate,
  Observation,
  IndependentProof,
} from "../shared/coach.ts";
import { independentCandidate } from "./independent-results.ts";
import { separateMonitors } from "./monitor-geometry.ts";

export function classifyIndependent(value: ObserverCandidate): Observation[] {
  const candidate = independentCandidate(value);
  if (!candidate || candidate.evidence.kind !== "independent-results")
    return [];
  return candidate.evidence.results.map((proof) => ({
    id: `${candidate.generation}:t${candidate.transaction}`,
    origin: candidate.origin,
    date: candidate.date,
    ...classifyProof(proof, candidate.origin),
  }));
}

function classifyProof(
  proof: IndependentProof,
  origin: "mouse" | "key",
): Pick<Observation, "operation" | "shortcut" | "monitor"> {
  switch (proof.kind) {
    case "switch":
      return {
        operation: "W01",
        shortcut: "Alt + Tab",
        monitor: proof.monitor,
      };
    case "monitor-move":
      return {
        operation: "W02",
        monitor: proof.toMonitor,
        shortcut: monitorShortcut(proof, origin),
      };
    case "state":
      return {
        operation: proof.action === "maximize" ? "W03" : "W04",
        monitor: proof.monitor,
        shortcut: stateShortcut(proof),
      };
    case "placement":
      return placementObservation(proof);
    case "close":
      return { operation: "W11", shortcut: "Alt + F4", monitor: proof.monitor };
    case "taskbar":
      return {
        operation: "W12",
        shortcut: `Win + ${proof.slot === 10 ? 0 : proof.slot}`,
        monitor: proof.monitor,
      };
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
  if (proof.action === "restore" || proof.beforeArranged === false)
    return "Win + ↓";
  return null;
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
