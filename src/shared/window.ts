import type { Bounds } from "./coach.ts";

export function isNormalBounds(value: unknown): value is Bounds {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = Object.entries(value);
  if (
    fields.length !== 4 ||
    !fields.every(
      ([key, n]) =>
        ["x", "y", "width", "height"].includes(key) &&
        typeof n === "number" &&
        Number.isSafeInteger(n) &&
        Math.abs(n) <= 1_000_000,
    )
  )
    return false;
  return (
    "width" in value &&
    typeof value.width === "number" &&
    value.width >= 800 &&
    "height" in value &&
    typeof value.height === "number" &&
    value.height >= 600
  );
}
