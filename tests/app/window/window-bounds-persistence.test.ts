import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleNormalBounds } from "../../../src/main/window-bounds.ts";
import { isNormalBounds } from "../../../src/shared/window.ts";

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
test("DIP defaults, negative monitor positions, caption reachability and small work areas", () => {
  assert.deepEqual(visibleNormalBounds(undefined, [primary]), {
    x: 400,
    y: 170,
    width: 1120,
    height: 700,
  });
  const negative = { x: -1600, y: -200, width: 1200, height: 900 };
  const saved = { x: -1500, y: -150, width: 1000, height: 650 };
  assert.deepEqual(visibleNormalBounds(saved, [primary, negative]), saved);
  assert.deepEqual(visibleNormalBounds(saved, [primary]), {
    x: 0,
    y: 0,
    width: 1000,
    height: 650,
  });
  assert.deepEqual(
    visibleNormalBounds({ x: 1800, y: 80, width: 1120, height: 700 }, [
      primary,
    ]),
    { x: 800, y: 80, width: 1120, height: 700 },
  );
  assert.deepEqual(
    visibleNormalBounds(undefined, [{ x: 0, y: 0, width: 640, height: 480 }]),
    { x: 0, y: 0, width: 800, height: 600 },
  );
  assert.equal(
    isNormalBounds({ x: NaN, y: 0, width: 800, height: 600 }),
    false,
  );
  assert.equal(isNormalBounds({ x: 0, y: 0, width: 799, height: 600 }), false);
  assert.equal(
    isNormalBounds({ x: 0, y: 0, width: 800, height: 600, title: "forbidden" }),
    false,
  );
});
