import type { Evidence, ObserverCandidate } from "../../shared/coach.ts";

// Retain the common envelope while narrowing the evidence at dispatch.
export type EvidenceCandidate<K extends Evidence["kind"]> = Omit<
  ObserverCandidate,
  "evidence"
> & {
  evidence: Extract<Evidence, { kind: K }>;
};
