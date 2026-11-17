import type { Observation } from "../../shared/coach.ts";
import { validDate } from "../dates.ts";
import { sameMonitor, separateMonitors } from "../monitor-geometry.ts";
import type { EvidenceCandidate } from "./types.ts";

export function classifyCompoundDrag(
  value: EvidenceCandidate<"compound-drag">,
): Observation[] {
  const e = value.evidence;
  if (
    e.profile !== "compound-drag-v1" ||
    !validDate(value.date) ||
    value.origin !== "mouse" ||
    value.route !== "compound-caption-drag" ||
    value.injected ||
    value.conflicted ||
    !e.targetMatched ||
    !e.released ||
    !e.layoutStable ||
    !Number.isFinite(e.inputAgeMs) ||
    e.inputAgeMs < 0 ||
    e.inputAgeMs > 1000 ||
    sameMonitor(e.fromMonitor, e.toMonitor) ||
    ![
      "maximized",
      "left-top",
      "right-top",
      "left-bottom",
      "right-bottom",
    ].includes(e.terminal)
  )
    return [];
  const equivalent =
    e.moveDirection &&
    e.fromMonitor.y === e.toMonitor.y &&
    (e.moveDirection === "left"
      ? e.toMonitor.x + e.toMonitor.width <= e.fromMonitor.x
      : e.fromMonitor.x + e.fromMonitor.width <= e.toMonitor.x);
  const base = {
    id: `${value.generation}:t${value.transaction}`,
    origin: "mouse" as const,
    date: value.date,
    monitor: e.toMonitor,
  };
  const [side, vertical] = e.terminal.split("-");
  return [
    {
      ...base,
      operation: "W02",
      shortcut: equivalent
        ? `Win + Shift + ${e.moveDirection === "left" ? "←" : "→"}`
        : e.twoDisplayLayoutConfirmed === true &&
            separateMonitors(e.fromMonitor, e.toMonitor)
          ? "Win + Shift + ←"
          : null,
    },
    {
      ...base,
      operation: e.terminal === "maximized" ? "W03" : "W07",
      shortcut: !e.terminalEquivalent
        ? null
        : e.terminal === "maximized"
          ? "Win + ↑"
          : `Winを押したまま ${side === "left" ? "←" : "→"}、続けて ${vertical === "top" ? "↑" : "↓"}`,
    },
  ];
}
