import { test } from "node:test";
import assert from "node:assert/strict";
import {
  finalCandidateDiagnostics,
  finalDiagnosticKeys,
} from "../../src/main/final-input-diagnostics.ts";
import { classifyGesture } from "../../src/core/detector.ts";
import { candidateFixture, v2Fixture } from "../support/fixtures.ts";
import {
  parseWindowDiagnostics,
  windowDiagnosticKeys,
} from "../../src/shared/window-diagnostics.ts";

test("native diagnostic schema accepts only the complete bounded fixed taxonomy", () => {
  const counts = Object.fromEntries(
    windowDiagnosticKeys.map((key) => [key, 0]),
  );
  assert.deepEqual(parseWindowDiagnostics(counts), counts);
  for (const value of [
    null,
    [],
    {},
    { ...counts, MouseDown: -1 },
    { ...counts, MouseDown: 1001 },
    { ...counts, MouseDown: 0.5 },
    { ...counts, privateTitle: "private-value" },
  ])
    assert.equal(parseWindowDiagnostics(value), null);
  assert.equal(
    parseWindowDiagnostics({ ...counts, MouseDown: 1000 })?.MouseDown,
    1000,
  );
});

test("diagnostic categories explain caption rejection without exposing raw fields or changing classification", () => {
  const candidate = v2Fixture(
    candidateFixture({
      app: "private-process",
      route: "private-route",
      origin: "unknown",
      inputAgeMs: 98765,
      targetMatched: false,
      moving: true,
      before: { state: "private-state", arranged: null },
      after: { state: "maximized" },
      afterArranged: false,
    }),
  );
  const before = structuredClone(candidate),
    observation = classifyGesture(candidate);
  const keys = finalCandidateDiagnostics(candidate);
  assert.ok(keys.every((key) => finalDiagnosticKeys.includes(key)));
  assert.ok(
    [
      "kind-window",
      "origin-unknown",
      "route-other",
      "input-old",
      "target-unmatched",
      "moving",
      "before-other",
      "app-category-unknown",
    ].every((key) => keys.includes(key as (typeof keys)[number])),
  );
  assert.equal(/private|98765/.test(JSON.stringify(keys)), false);
  assert.deepEqual(candidate, before);
  assert.deepEqual(classifyGesture(candidate), observation);
  const accepted = v2Fixture(
    candidateFixture({ app: "ordinary-window", route: "caption-double-click" }),
  );
  assert.ok(
    finalCandidateDiagnostics(accepted).includes("route-caption-double-click"),
  );
  assert.equal(classifyGesture(accepted)[0]?.operation, "W03");
  const fallback = v2Fixture(candidateFixture({ route: "mouse-state-fallback", inputAgeMs: 500 }));
  assert.ok(finalCandidateDiagnostics(fallback).includes("route-mouse-state-fallback"));
  assert.equal(classifyGesture(fallback)[0]?.operation, "W03");
  for (const property of ["__proto__", "constructor", "toString"]) {
    const keys = finalCandidateDiagnostics(
      v2Fixture(candidateFixture({ route: property, operation: property })),
    );
    assert.ok(keys.every((key) => finalDiagnosticKeys.includes(key)));
    assert.ok(keys.includes("route-other"));
    assert.ok(keys.includes("operation-other"));
  }
});
