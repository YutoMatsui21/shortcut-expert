import { test } from "node:test";
import assert from "node:assert/strict";
import { classify as classifyV2 } from "../../src/core/detector.ts";
import type { OperationId } from "../../src/shared/coach.ts";
import { v2Fixture, type Candidate } from "../support/fixtures.ts";

const classify = (value: Candidate) => classifyV2(v2Fixture(value));

const base: Candidate = {
  type: "candidate",
  protocolVersion: 1,
  generation: 1,
  sequence: 1,
  app: "chrome",
  date: "2026-10-12",
  operation: "minimize",
  before: { state: "normal", arranged: false },
  after: { state: "minimized" },
  origin: "mouse",
  route: "min-button",
  injected: false,
  conflicted: false,
  moving: false,
  elevated: false,
  targetMatched: true,
  inputAgeMs: 100,
  monitor: { x: 0, y: 0, width: 1920, height: 1080 },
};
export const addedCases: {
  id: OperationId;
  candidate: Candidate;
  key: string;
  shortcut: string;
}[] = [
  { id: "W04", candidate: base, key: "win-down", shortcut: "Win + ↓" },
  {
    id: "W04",
    candidate: {
      ...base,
      operation: "restore",
      before: { state: "maximized", arranged: false },
      after: { state: "normal" },
      afterArranged: false,
      route: "max-button",
    },
    key: "win-down",
    shortcut: "Win + ↓",
  },
  {
    id: "W11",
    candidate: {
      ...base,
      operation: "close",
      after: { state: "closed" },
      route: "close-button",
    },
    key: "alt-f4",
    shortcut: "Alt + F4",
  },
  {
    id: "W02",
    candidate: {
      ...base,
      operation: "monitor-move",
      moveConfirmed: true,
      afterArranged: false,
      after: { state: "normal" },
      route: "caption-drag",
      fromMonitor: base.monitor,
      toMonitor: { x: 1920, y: 0, width: 1920, height: 1080 },
      moveDirection: "right",
    },
    key: "win-shift-right",
    shortcut: "Win + Shift + →",
  },
];

for (const entry of addedCases) {
  test(`${entry.id}は操作・由来・結果を照合して採用し、不十分な証拠を除外する`, () => {
    for (const app of ["chrome", "obsidian", "code", "chatgpt"]) {
      assert.equal(classify({ ...entry.candidate, app })?.operation, entry.id);
      assert.equal(
        classify({ ...entry.candidate, app, origin: "key", route: entry.key })
          ?.shortcut,
        entry.shortcut,
      );
    }
    for (const invalid of [
      { injected: true },
      { conflicted: true },
      { targetMatched: false },
      { moving: true },
      { inputAgeMs: 1001 },
      { inputAgeMs: -1 },
      { origin: "unknown" as const },
      { route: "client-click" },
      { elevated: true },
      { app: "codex" },
      { after: { state: "other" } },
    ]) {
      assert.equal(
        classify({ ...entry.candidate, ...invalid }),
        null,
        JSON.stringify(invalid),
      );
    }
  });
}

test("元状態に合わない最小化・復元と元画面への往復を除外する", () => {
  const minimize = addedCases[0].candidate,
    restore = addedCases[1].candidate,
    move = addedCases[3].candidate;
  for (const before of [
    { state: "normal", arranged: true },
    { state: "normal", arranged: null },
  ]) {
    assert.equal(classify({ ...minimize, before })?.shortcut, null);
    assert.equal(
      classify({ ...minimize, before, origin: "key", route: "win-down" }),
      null,
    );
  }
  assert.equal(
    classify({ ...restore, before: { state: "normal", arranged: true } }),
    null,
  );
  assert.equal(classify({ ...restore, afterArranged: true }), null);
  assert.equal(classify({ ...restore, afterArranged: undefined }), null);
  assert.equal(
    classify({ ...restore, route: "caption-double-click" })?.operation,
    "W04",
  );
  assert.equal(classify({ ...move, toMonitor: move.fromMonitor }), null);
  assert.equal(classify({ ...move, fromMonitor: null }), null);
  assert.equal(classify({ ...move, moveDirection: null })?.shortcut, null);
  assert.equal(
    classify({ ...move, origin: "key", route: "win-shift-left" })?.shortcut,
    null,
  );
  for (const moveConfirmed of [false, undefined])
    assert.equal(classify({ ...move, moveConfirmed }), null);
});

test("two-display vertical standalone move preserves actual key route and requires layout proof", () => {
  const move: Candidate = {
    ...addedCases[3].candidate,
    moveDirection: null,
    twoDisplayLayoutConfirmed: true,
    toMonitor: { x: 0, y: -1440, width: 2560, height: 1440 },
  };
  assert.equal(classify(move)?.shortcut, "Win + Shift + ←");
  for (const [route, arrow] of [
    ["win-shift-left", "←"],
    ["win-shift-right", "→"],
  ])
    assert.equal(
      classify({ ...move, origin: "key", route })?.shortcut,
      `Win + Shift + ${arrow}`,
    );
  for (const proof of [false, undefined])
    assert.equal(
      classify({ ...move, twoDisplayLayoutConfirmed: proof })?.shortcut,
      null,
    );
  assert.equal(
    classify({ ...move, toMonitor: { ...move.fromMonitor!, y: -100 } })
      ?.shortcut,
    null,
  );
  assert.equal(classify({ ...move, moveConfirmed: false }), null);
});
