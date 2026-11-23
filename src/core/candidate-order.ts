import type { ObserverCandidate } from "../shared/coach.ts";

function validCandidateId(id: number): boolean {
  return Number.isInteger(id) && id >= 1 && id <= 0x7fffffff;
}

// Sequences must advance, while transactions can complete out of input order.
export class CandidateOrder {
  private sequence = 0;
  private transactions = new Set<number>();
  private latestTransaction = 0;

  reset(): void {
    this.sequence = 0;
    this.transactions.clear();
    this.latestTransaction = 0;
  }

  accept(candidate: ObserverCandidate): boolean {
    if (!validCandidateId(candidate.sequence)) return false;
    if (candidate.sequence <= this.sequence) return false;
    if (candidate.protocolVersion !== 2) return false;
    this.sequence = candidate.sequence;
    return this.acceptTransaction(candidate);
  }
  private acceptTransaction({ transaction: id }: ObserverCandidate): boolean {
    if (!validCandidateId(id) || this.transactions.has(id)) return false;
    if (id <= this.latestTransaction - 4096) return false;
    this.latestTransaction = Math.max(this.latestTransaction, id);
    this.transactions.add(id);
    for (const seen of this.transactions) {
      if (seen <= this.latestTransaction - 4096) this.transactions.delete(seen);
    }
    return true;
  }
}
