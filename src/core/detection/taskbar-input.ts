import type { Observation } from "../../shared/coach.ts";
import { validDate } from "../dates.ts";
import type { EvidenceCandidate } from "./types.ts";

export function classifyTaskbarInput(
  value: EvidenceCandidate<"taskbar-input">,
): Observation | null {
  const e = value.evidence;
  if (value.origin !== "mouse" && value.origin !== "key") return null;
  if (
    e.profile !== "taskbar-input-v1" ||
    !validDate(value.date) ||
    value.injected ||
    value.conflicted ||
    !e.mappingConfirmed ||
    !Number.isInteger(e.slot) ||
    e.slot === null ||
    e.slot < 1 ||
    e.slot > 10 ||
    !Number.isFinite(e.snapshotAgeMs) ||
    e.snapshotAgeMs < 0 ||
    e.snapshotAgeMs > 750 ||
    !Number.isFinite(e.confirmationAgeMs) ||
    e.confirmationAgeMs < 0 ||
    e.confirmationAgeMs > 2500 ||
    (value.origin === "mouse"
      ? value.route !== "taskbar-click"
      : value.origin !== "key" || value.route !== "win-digit")
  )
    return null;
  return {
    id: `${value.generation}:t${value.transaction}`,
    operation: "W12",
    origin: value.origin,
    date: value.date,
    shortcut: `Win + ${e.slot === 10 ? 0 : e.slot}`,
    monitor: e.monitor,
  };
}
