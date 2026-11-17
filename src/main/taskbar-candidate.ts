import type { ObserverCandidate } from "../shared/coach.ts";

// Read only the bounded slot from an already classified W12 candidate.
export function taskbarCandidateSlot(
  value: ObserverCandidate,
): number | undefined {
  if (value.protocolVersion !== 2) return undefined;
  if (value.evidence.kind === "taskbar-input")
    return value.evidence.slot ?? undefined;
  if (value.evidence.kind === "independent-results")
    return value.evidence.results.find((proof) => proof.kind === "taskbar")
      ?.slot;
  return undefined;
}
