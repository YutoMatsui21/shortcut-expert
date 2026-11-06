import { validDate } from "../core/dates.ts";
import type { Counts, Settings } from "../shared/coach.ts";
import { operations } from "../shared/coach.ts";
import { isLearningState } from "../shared/learning.ts";
import { recordOperations } from "../shared/storage.ts";
import { isNormalBounds } from "../shared/window.ts";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function validCounter(value: unknown): value is { mouse: number; key: number } {
  if (!object(value) || !keys(value, ["mouse", "key"])) return false;
  return ["mouse", "key"].every((kind) => {
    const count = value[kind];
    return (
      typeof count === "number" && Number.isSafeInteger(count) && count >= 0
    );
  });
}
function validDay(value: unknown): value is Counts[string] {
  return (
    object(value) &&
    Object.entries(value).every(
      ([operation, counter]) =>
        operations.some((op) => op.id === operation) && validCounter(counter),
    )
  );
}
function validCounts(value: unknown): value is Counts {
  return (
    object(value) &&
    Object.entries(value).every(
      ([date, day]) => validDate(date) && validDay(day),
    )
  );
}
export function countsDocument(value: unknown): Counts | null {
  if (
    !object(value) ||
    !keys(value, ["schemaVersion", "days"]) ||
    value.schemaVersion !== 1
  )
    return null;
  return validCounts(value.days) ? value.days : null;
}
export function settingsDocument(value: unknown): Settings | null {
  if (
    !object(value) ||
    !keys(value, ["schemaVersion", "muted", "opened"]) ||
    value.schemaVersion !== 1
  )
    return null;
  const settings = { muted: value.muted, opened: value.opened };
  return validSettings(settings) &&
    settings.muted.every((id) => operations.some((op) => op.id === id))
    ? settings
    : null;
}
function validSettings(value: unknown): value is Settings {
  const ids = [...operations.map((op) => op.id), ...recordOperations];
  return (
    object(value) &&
    keys(value, ["muted", "opened", "states", "normalBounds"]) &&
    typeof value.opened === "boolean" &&
    (value.normalBounds === undefined || isNormalBounds(value.normalBounds)) &&
    Array.isArray(value.muted) &&
    value.muted.every((id) => ids.includes(id)) &&
    new Set(value.muted).size === value.muted.length &&
    (value.states === undefined ||
      (object(value.states) &&
        Object.entries(value.states).every(
          ([id, state]) =>
            ids.some((value) => value === id) && isLearningState(state),
        )))
  );
}
