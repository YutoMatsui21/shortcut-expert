import type { Observation } from "../../shared/coach.ts";
import { validDate } from "../dates.ts";
import type { EvidenceCandidate } from "./types.ts";

export function classifyWindowClose(
  value: EvidenceCandidate<"window-close">,
): Observation | null {
  const e = value.evidence;
  if (
    !validDate(value.date) ||
    value.injected ||
    value.conflicted ||
    !e.targetMatched ||
    !e.destroyed ||
    e.profile !== "window-close-v1" ||
    !Number.isFinite(e.inputAgeMs) ||
    e.inputAgeMs < 0 ||
    e.inputAgeMs > 1000 ||
    (value.origin === "mouse"
      ? value.route !== "close-button"
      : value.origin !== "key" || value.route !== "alt-f4")
  )
    return null;
  return {
    id: `${value.generation}:t${value.transaction}`,
    operation: "W11",
    origin: value.origin === "mouse" ? "mouse" : "key",
    date: value.date,
    shortcut: "Alt + F4",
    monitor: e.monitor,
  };
}
