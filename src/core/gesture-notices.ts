import type {
  Observation,
  OperationId,
  Settings,
  ShortcutNotice,
} from "../shared/coach.ts";
import { learningOperations, learningState } from "../shared/learning.ts";

type NoticeToken = {
  observation: Observation;
  operationEpoch: number;
};

type PreparedNotice = {
  epoch: number;
  tokens: NoticeToken[];
};

export class GestureNotices {
  private epoch = 0;
  private operationEpochs = new Map<OperationId, number>();

  invalidate(): void {
    this.epoch++;
  }

  invalidateOperation(id: OperationId): void {
    this.operationEpochs.set(id, this.operationEpoch(id) + 1);
  }

  private operationEpoch(id: OperationId): number {
    return this.operationEpochs.get(id) ?? 0;
  }

  prepare(
    observations: Observation[],
    settings: Settings,
    paused: boolean,
  ): PreparedNotice {
    const tokens = paused
      ? []
      : observations
          .filter((observation) => isEligible(observation, settings))
          .map((observation) => ({
            observation,
            operationEpoch: this.operationEpoch(observation.operation),
          }));
    return { epoch: this.epoch, tokens };
  }

  deliver(
    notice: PreparedNotice,
    settings: Settings,
    delivery: { notify(value: ShortcutNotice): Promise<boolean> },
  ): void {
    if (notice.epoch !== this.epoch) return;
    const items = notice.tokens
      .filter(({ observation, operationEpoch }) => {
        const id = observation.operation;
        return (
          operationEpoch === this.operationEpoch(id) &&
          learningState(settings, id) === "learning"
        );
      })
      .map(({ observation }) => ({
        operation: observation.operation,
        label: learningOperations.find((op) => op.id === observation.operation)!
          .label,
        shortcut: observation.shortcut!,
      }));
    if (!items.length) return;
    // One consumed delivery token per gesture, including unknown OS outcomes.
    try {
      void delivery
        .notify({ ...items[0], ...(items.length > 1 ? { items } : {}) })
        .catch(() => {});
    } catch {
      /* An unknown delivery result must never trigger an automatic resend. */
    }
  }
}

function isEligible(observation: Observation, settings: Settings): boolean {
  return (
    observation.origin === "mouse" &&
    !!observation.shortcut &&
    learningState(settings, observation.operation) === "learning"
  );
}
