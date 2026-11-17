import type { ObserverCandidate, Observation } from "../shared/coach.ts";
import { classifyProof } from "./detection/independent-proofs.ts";
import { independentCandidate } from "./independent-results.ts";

export function classifyIndependent(value: ObserverCandidate): Observation[] {
  const candidate = independentCandidate(value);
  if (!candidate || candidate.evidence.kind !== "independent-results")
    return [];
  return candidate.evidence.results.map((proof) => ({
    id: `${candidate.generation}:t${candidate.transaction}`,
    origin: candidate.origin,
    date: candidate.date,
    ...classifyProof(proof, candidate.origin),
  }));
}
