import { test } from "node:test";
import assert from "node:assert/strict";
import { learningOperations } from "../../src/shared/learning.ts";
import { learningReadModel } from "../../src/core/learning.ts";
import { recordsReadModel } from "../../src/core/records.ts";
import { defaultRecordsQuery } from "../../src/shared/records.ts";
import { classify as classifyV2 } from "../../src/core/detector.ts";
import { snapFixture, v2Fixture } from "../support/fixtures.ts";
import type { Candidate } from "../support/fixtures.ts";

const classify = (value: Parameters<typeof v2Fixture>[0]) =>
  classifyV2(v2Fixture(value));

const ids = ["W12", "W01", "W03", "W04", "W06", "W07", "W02", "W11"];
test("初回8操作だけを表示・集計し、旧W05/W08/W10を合算しない", () => {
  assert.deepEqual(
    learningOperations.map((v) => v.id),
    ids,
  );
  const records = {
    counts: {
      "2026-10-27": {
        W04: { mouse: 1, key: 2 },
        W05: { mouse: 100, key: 100 },
        W08: { mouse: 100, key: 100 },
        W10: { mouse: 100, key: 100 },
      },
    },
    coverage: {},
    revision: 1,
  };
  const settings = { muted: [], opened: true };
  const learning = learningReadModel(records, settings, "2026-10-27");
  assert.deepEqual(
    learning.rows.map((v) => v.id),
    ids,
  );
  assert.equal(learning.rows.find((v) => v.id === "W04")?.total, 3);
  const summary = recordsReadModel(
    records,
    settings,
    "2026-10-27",
    defaultRecordsQuery,
  );
  assert.equal(summary.summary.total, 3);
});

test("W08は過去の有効な証拠でも初回版では採用しない", () => {
  for (const origin of ["mouse", "key"] as const)
    assert.equal(classify(snapFixture(origin)), null);
});

const minimize: Candidate = {
  type: "candidate",
  protocolVersion: 1,
  generation: 1,
  sequence: 1,
  app: "chrome",
  date: "2026-10-27",
  operation: "minimize",
  before: { state: "maximized", arranged: false },
  after: { state: "minimized" },
  origin: "mouse",
  route: "min-button",
  injected: false,
  conflicted: false,
  moving: false,
  elevated: false,
  targetMatched: true,
  inputAgeMs: 100,
  monitor: null,
};
test("最大化解除と最大化中の最小化ボタンはW04へ帰属し、反復が必要な案内を区別する", () => {
  const minimized = classify(minimize);
  assert.equal(minimized?.operation, "W04");
  assert.match(minimized?.shortcut ?? "", /Win.*↓.*繰り返/);
  const restored = classify({
    ...minimize,
    operation: "restore",
    after: { state: "normal" },
    afterArranged: false,
    route: "max-button",
  });
  assert.equal(restored?.operation, "W04");
  assert.equal(restored?.shortcut, "Win + ↓");
});
