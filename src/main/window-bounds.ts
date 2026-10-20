import type { Bounds } from '../shared/coach.ts';
import { isNormalBounds } from '../shared/window.ts';

// Coordinates and work areas are Electron DIP; never convert them to physical pixels.
export function visibleNormalBounds(saved: Bounds | undefined, areas: Bounds[]): Bounds {
  const primary = areas[0] ?? { x: 0, y: 0, width: 1120, height: 700 };
  const bounds = isNormalBounds(saved) ? { ...saved } : {
    x: primary.x + Math.max(0, Math.floor((primary.width - 1120) / 2)),
    y: primary.y + Math.max(0, Math.floor((primary.height - 700) / 2)), width: 1120, height: 700
  };
  // Retain valid negative coordinates. Require the whole caption, including controls,
  // on one work area so the user can still drag, minimize, restore and close.
  if (areas.some(area => bounds.x >= area.x && bounds.x + bounds.width <= area.x + area.width &&
    bounds.y >= area.y && bounds.y + 32 <= area.y + area.height)) return bounds;
  const area = areas.reduce((best, next) => {
    const overlap = (a: Bounds) => Math.max(0, Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x)) *
      Math.max(0, Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y));
    return overlap(next) > overlap(best) ? next : best;
  }, primary);
  bounds.width = Math.max(800, Math.min(bounds.width, area.width));
  bounds.height = Math.max(600, Math.min(bounds.height, area.height));
  bounds.x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width));
  bounds.y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height));
  return bounds;
}
