import type { Observation } from "../../shared/coach.ts";
import { validDate } from "../dates.ts";
import type { EvidenceCandidate } from "./types.ts";

export function classifyWindowSwitch(
  value: EvidenceCandidate<"window-switch">,
): Observation | null {
  if (value.origin !== "mouse" && value.origin !== "key") return null;
  const e = value.evidence;
  if (invalidSwitchContext(value)) return null;
  if (invalidSwitchProof(value)) return null;
  if (invalidSwitchTiming(value)) return null;
  if (invalidSwitchRouteTiming(value)) return null;
  return {
    id: `${value.generation}:t${value.transaction}`,
    operation: "W01",
    origin: value.origin,
    date: value.date,
    shortcut: "Alt + Tab",
    monitor: e.monitor,
  };
}

function invalidSwitchContext(
  value: EvidenceCandidate<"window-switch">,
): boolean {
  const e = value.evidence;
  return (
    (value.origin !== "mouse" && value.origin !== "key") ||
    !validDate(value.date) ||
    value.injected ||
    value.conflicted ||
    e.profile !== "window-switch-v1"
  );
}

function invalidSwitchProof(
  value: EvidenceCandidate<"window-switch">,
): boolean {
  const e = value.evidence;
  return (
    !e.windowsDifferent ||
    !e.eligible ||
    !e.inputTargetMatched ||
    !e.foregroundMatched
  );
}

function invalidSwitchTiming(
  value: EvidenceCandidate<"window-switch">,
): boolean {
  const e = value.evidence;
  return (
    !Number.isFinite(e.inputAgeMs) ||
    e.inputAgeMs < 0 ||
    !Number.isFinite(e.settleMs) ||
    e.settleMs < 0 ||
    e.settleMs > e.inputAgeMs
  );
}

function invalidSwitchRouteTiming(
  value: EvidenceCandidate<"window-switch">,
): boolean {
  const e = value.evidence;
  return value.origin === "mouse"
    ? value.route !== "direct-click" || e.inputAgeMs > 1500 || e.settleMs > 1500
    : value.route !== "alt-tab" ||
        e.inputAgeMs > 15000 ||
        e.settleMs < 250 ||
        e.settleMs > 2000;
}
