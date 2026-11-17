import type { Observation } from "../../shared/coach.ts";
import { validDate } from "../dates.ts";
import { sameMonitor, separateMonitors } from "../monitor-geometry.ts";
import type { EvidenceCandidate } from "./types.ts";

export function classifyCompoundDrag(
  value: EvidenceCandidate<"compound-drag">,
): Observation[] {
  const e = value.evidence;
  if (invalidDragContext(value)) return [];
  if (invalidDragProof(value)) return [];
  if (invalidDragTiming(value)) return [];
  if (invalidDragTerminal(value)) return [];
  const base = {
    id: `${value.generation}:t${value.transaction}`,
    origin: "mouse" as const,
    date: value.date,
    monitor: e.toMonitor,
  };
  return [
    {
      ...base,
      operation: "W02",
      shortcut: dragMoveShortcut(e),
    },
    {
      ...base,
      operation: e.terminal === "maximized" ? "W03" : "W07",
      shortcut: dragTerminalShortcut(e),
    },
  ];
}

function invalidDragContext(
  value: EvidenceCandidate<"compound-drag">,
): boolean {
  const e = value.evidence;
  return (
    e.profile !== "compound-drag-v1" ||
    !validDate(value.date) ||
    value.origin !== "mouse" ||
    value.route !== "compound-caption-drag"
  );
}

function invalidDragProof(value: EvidenceCandidate<"compound-drag">): boolean {
  const e = value.evidence;
  return (
    value.injected ||
    value.conflicted ||
    !e.targetMatched ||
    !e.released ||
    !e.layoutStable
  );
}

function invalidDragTiming(value: EvidenceCandidate<"compound-drag">): boolean {
  const e = value.evidence;
  return (
    !Number.isFinite(e.inputAgeMs) || e.inputAgeMs < 0 || e.inputAgeMs > 1000
  );
}

function invalidDragTerminal(
  value: EvidenceCandidate<"compound-drag">,
): boolean {
  const e = value.evidence;
  return (
    sameMonitor(e.fromMonitor, e.toMonitor) ||
    ![
      "maximized",
      "left-top",
      "right-top",
      "left-bottom",
      "right-bottom",
    ].includes(e.terminal)
  );
}

type DragEvidence = EvidenceCandidate<"compound-drag">["evidence"];
function dragMoveShortcut(e: DragEvidence): string | null {
  const equivalent =
    e.moveDirection &&
    e.fromMonitor.y === e.toMonitor.y &&
    (e.moveDirection === "left"
      ? e.toMonitor.x + e.toMonitor.width <= e.fromMonitor.x
      : e.fromMonitor.x + e.fromMonitor.width <= e.toMonitor.x);
  if (equivalent)
    return `Win + Shift + ${e.moveDirection === "left" ? "←" : "→"}`;
  return e.twoDisplayLayoutConfirmed === true &&
    separateMonitors(e.fromMonitor, e.toMonitor)
    ? "Win + Shift + ←"
    : null;
}
function dragTerminalShortcut(e: DragEvidence): string | null {
  if (!e.terminalEquivalent) return null;
  if (e.terminal === "maximized") return "Win + ↑";
  const [side, vertical] = e.terminal.split("-");
  return `Winを押したまま ${side === "left" ? "←" : "→"}、続けて ${vertical === "top" ? "↑" : "↓"}`;
}
