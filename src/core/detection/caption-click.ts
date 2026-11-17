import type { Observation } from "../../shared/coach.ts";
import { validDate } from "../dates.ts";
import type { EvidenceCandidate } from "./types.ts";

export function classifyCaptionClick(
  value: EvidenceCandidate<"caption-click">,
): Observation[] {
  const e = value.evidence;
  if (invalidCaptionContext(value)) return [];
  if (invalidCaptionProof(value)) return [];
  if (invalidCaptionTiming(value)) return [];
  if (invalidCaptionTerminal(value)) return [];
  const base = {
    id: `${value.generation}:t${value.transaction}`,
    origin: "mouse" as const,
    date: value.date,
    monitor: e.monitor,
  };
  const results: Observation[] = [];
  if (e.switched)
    results.push({ ...base, operation: "W01", shortcut: "Alt + Tab" });
  if (e.terminal !== null)
    results.push({
      ...base,
      operation: e.terminal === "maximized" ? "W03" : "W04",
      shortcut: e.terminal === "maximized" ? "Win + ↑" : "Win + ↓",
    });
  return results;
}

function invalidCaptionContext(
  value: EvidenceCandidate<"caption-click">,
): boolean {
  const e = value.evidence;
  return (
    e.profile !== "caption-click-v1" ||
    !validDate(value.date) ||
    value.origin !== "mouse" ||
    value.route !== "inactive-caption-click"
  );
}

function invalidCaptionProof(
  value: EvidenceCandidate<"caption-click">,
): boolean {
  const e = value.evidence;
  return value.injected || value.conflicted || !e.targetMatched || !e.released;
}

function invalidCaptionTiming(
  value: EvidenceCandidate<"caption-click">,
): boolean {
  const e = value.evidence;
  return (
    !Number.isFinite(e.inputAgeMs) || e.inputAgeMs < 0 || e.inputAgeMs > 500
  );
}

function invalidCaptionTerminal(
  value: EvidenceCandidate<"caption-click">,
): boolean {
  const e = value.evidence;
  return !(
    e.terminal === null ||
    e.terminal === "maximized" ||
    e.terminal === "minimized"
  );
}
