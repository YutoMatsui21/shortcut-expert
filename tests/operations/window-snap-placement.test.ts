import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { classify } from "../../src/core/detector.ts";
mock.module("electron", { namedExports: { app: {} } });
const { candidateV2 } = await import("../../src/main/observer.ts");

export function placement(origin = "mouse", shape = "left-half") {
  return {
    type: "candidate",
    protocolVersion: 2,
    generation: 1,
    sequence: 1,
    transaction: 1,
    date: "2026-10-28",
    origin,
    route: origin === "mouse" ? "caption-edge-drag" : "win-held-arrows",
    injected: false,
    conflicted: false,
    evidence: {
      kind: "placement",
      profile: "placement-v1",
      shape,
      targetMatched: true,
      inputAgeMs: 100,
      monitorChanged: false,
      monitor: { x: 0, y: 0, width: 1920, height: 1080 },
    },
  };
}

test("W06/W07: both halves and four quarters remain separate observations with exact key guidance", () => {
  for (const origin of ["mouse", "key"])
    for (const side of ["left", "right"])
      for (const vertical of ["half", "top", "bottom"]) {
        const parsed = candidateV2(placement(origin, `${side}-${vertical}`));
        assert.ok(parsed);
        const value = classify(parsed);
        assert.ok(value);
        assert.equal(value.operation, vertical === "half" ? "W06" : "W07");
        assert.equal(
          value.shortcut,
          vertical === "half"
            ? `Win + ${side === "left" ? "←" : "→"}`
            : `Winを押したまま ${side === "left" ? "←" : "→"}、続けて ${vertical === "top" ? "↑" : "↓"}`,
        );
      }
});

test("unverified placement, competing input and cross-monitor result do not enter the single-operation writer", () => {
  for (const update of [
    { origin: "unknown" },
    { injected: true },
    { conflicted: true },
    { route: "snap-layout" },
  ]) {
    const parsed = candidateV2({ ...placement(), ...update });
    assert.ok(parsed);
    assert.equal(classify(parsed), null);
  }
  for (const update of [
    { targetMatched: false },
    { monitorChanged: true },
    { inputAgeMs: 15001 },
  ]) {
    const raw = placement();
    const parsed = candidateV2({
      ...raw,
      evidence: { ...raw.evidence, ...update },
    });
    assert.ok(parsed);
    assert.equal(classify(parsed), null);
  }
  for (const update of [
    { shape: "free" },
    { profile: "unverified" },
    { inputAgeMs: -1 },
    { monitor: null },
    { targetMatched: null },
  ]) {
    const raw = placement();
    assert.equal(
      candidateV2({ ...raw, evidence: { ...raw.evidence, ...update } }),
      null,
    );
  }
});
