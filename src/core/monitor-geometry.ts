import type { Bounds } from "../shared/coach.ts";

export function sameMonitor(a: Bounds, b: Bounds): boolean {
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}

// Two endpoint bounds alone do not prove a complete two-display layout.
export function separateMonitors(a: Bounds, b: Bounds): boolean {
  return (
    [a, b].every(
      (r) =>
        [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
        r.width > 0 &&
        r.height > 0,
    ) &&
    (a.x + a.width <= b.x ||
      b.x + b.width <= a.x ||
      a.y + a.height <= b.y ||
      b.y + b.height <= a.y)
  );
}
