import type { Observation } from "../../shared/coach.ts";
import { validDate } from "../dates.ts";
import type { EvidenceCandidate } from "./types.ts";

export function classifyTaskbarInput(
  value: EvidenceCandidate<"taskbar-input">,
): Observation | null {
  const e = value.evidence;
  if (value.origin !== "mouse" && value.origin !== "key") return null;
  if (invalidTaskbarContext(value)) return null;
  if (invalidTaskbarSlot(value)) return null;
  if (invalidTaskbarSnapshotAge(value)) return null;
  if (invalidTaskbarConfirmationAge(value)) return null;
  if (invalidTaskbarRoute(value)) return null;
  return {
    id: `${value.generation}:t${value.transaction}`,
    operation: "W12",
    origin: value.origin,
    date: value.date,
    shortcut: `Win + ${e.slot === 10 ? 0 : e.slot}`,
    monitor: e.monitor,
  };
}

function invalidTaskbarContext(
  value: EvidenceCandidate<"taskbar-input">,
): boolean {
  const e = value.evidence;
  return (
    e.profile !== "taskbar-input-v1" ||
    !validDate(value.date) ||
    value.injected ||
    value.conflicted
  );
}

function invalidTaskbarSlot(
  value: EvidenceCandidate<"taskbar-input">,
): boolean {
  const e = value.evidence;
  return (
    !e.mappingConfirmed ||
    !Number.isInteger(e.slot) ||
    e.slot === null ||
    e.slot < 1 ||
    e.slot > 10
  );
}

function invalidTaskbarSnapshotAge(
  value: EvidenceCandidate<"taskbar-input">,
): boolean {
  const e = value.evidence;
  return (
    !Number.isFinite(e.snapshotAgeMs) ||
    e.snapshotAgeMs < 0 ||
    e.snapshotAgeMs > 750
  );
}

function invalidTaskbarConfirmationAge(
  value: EvidenceCandidate<"taskbar-input">,
): boolean {
  const e = value.evidence;
  return (
    !Number.isFinite(e.confirmationAgeMs) ||
    e.confirmationAgeMs < 0 ||
    e.confirmationAgeMs > 2500
  );
}

function invalidTaskbarRoute(
  value: EvidenceCandidate<"taskbar-input">,
): boolean {
  return value.origin === "mouse"
    ? value.route !== "taskbar-click"
    : value.origin !== "key" || value.route !== "win-digit";
}
