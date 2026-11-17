import type { Observation } from "../../shared/coach.ts";
import { validDate } from "../dates.ts";
import type { EvidenceCandidate } from "./types.ts";

export function classifyPlacement(
  value: EvidenceCandidate<"placement">,
): Observation | null {
  const e = value.evidence;
  if (
    invalidPlacementContext(value) ||
    invalidPlacementProof(value) ||
    invalidPlacementTiming(value) ||
    invalidPlacementRouteOrShape(value)
  )
    return null;
  const [side, vertical] = e.shape.split("-");
  const horizontal = side === "left" ? "←" : "→";
  return {
    id: `${value.generation}:t${value.transaction}`,
    operation: vertical === "half" ? "W06" : "W07",
    origin: value.origin === "mouse" ? "mouse" : "key",
    date: value.date,
    monitor: e.monitor,
    shortcut:
      vertical === "half"
        ? `Win + ${horizontal}`
        : `Winを押したまま ${horizontal}、続けて ${vertical === "top" ? "↑" : "↓"}`,
  };
}

function invalidPlacementContext(
  value: EvidenceCandidate<"placement">,
): boolean {
  const e = value.evidence;
  return !validDate(value.date) || value.injected || value.conflicted;
}

function invalidPlacementProof(value: EvidenceCandidate<"placement">): boolean {
  const e = value.evidence;
  return !e.targetMatched || e.monitorChanged || e.profile !== "placement-v1";
}

function invalidPlacementTiming(
  value: EvidenceCandidate<"placement">,
): boolean {
  const e = value.evidence;
  return !Number.isFinite(e.inputAgeMs) || e.inputAgeMs < 0;
}

function invalidPlacementRouteOrShape(
  value: EvidenceCandidate<"placement">,
): boolean {
  const e = value.evidence;
  return (
    (value.origin === "mouse"
      ? value.route !== "caption-edge-drag" || e.inputAgeMs > 1000
      : value.origin !== "key" ||
        value.route !== "win-held-arrows" ||
        e.inputAgeMs > 15000) ||
    ![
      "left-half",
      "right-half",
      "left-top",
      "right-top",
      "left-bottom",
      "right-bottom",
    ].includes(e.shape)
  );
}
