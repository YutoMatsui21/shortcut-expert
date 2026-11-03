import type { Settings } from "../shared/coach.ts";
import {
  learningOperations,
  learningState,
  type LearningReadModel,
} from "../shared/learning.ts";
import { daysBefore, type RecordRange } from "../shared/storage.ts";

export function learningReadModel(
  records: RecordRange,
  settings: Settings,
  today: string,
): LearningReadModel {
  const from = daysBefore(today, 6);
  return {
    from,
    to: today,
    revision: records.revision,
    rows: learningOperations.map(({ id }) => {
      let mouse = 0n,
        key = 0n,
        known = false;
      for (let day = from; day <= today; day = daysBefore(day, -1)) {
        const count = records.counts[day]?.[id];
        if (count) {
          mouse += BigInt(count.mouse);
          key += BigInt(count.key);
          known = true;
        }
        if (records.coverage[day]?.[id]?.knowledge === "observed") known = true;
      }
      const total = mouse + key;
      if (total > BigInt(Number.MAX_SAFE_INTEGER))
        throw new Error("操作回数の合計が安全な範囲を超えています。");
      return {
        id,
        state: learningState(settings, id),
        mouse: known ? Number(mouse) : null,
        key: known ? Number(key) : null,
        total: known ? Number(total) : null,
        rate: total ? Number((key * 1000n + total / 2n) / total) / 10 : null,
      };
    }),
  };
}
