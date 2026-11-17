import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, classifyGesture } from "../../src/core/detector.ts";
import type {
  Evidence,
  IndependentProof,
  CandidateV2,
} from "../../src/shared/coach.ts";
import {
  independentFixture,
  independentProofs,
} from "../support/independent-results.ts";

function legacy(proof: IndependentProof): CandidateV2 {
  const base = independentFixture([proof]);
  let evidence: Evidence;
  switch (proof.kind) {
    case "switch":
      evidence = {
        ...proof,
        kind: "window-switch",
        profile: "window-switch-v1",
        inputTargetMatched: true,
      };
      break;
    case "monitor-move":
      evidence = {
        kind: "window",
        profile: "legacy-window-v1",
        result: {
          app: "ordinary-window",
          operation: "monitor-move",
          before: { state: "normal", arranged: false },
          after: { state: "normal" },
          moving: false,
          elevated: false,
          targetMatched: true,
          inputAgeMs: proof.inputAgeMs,
          monitor: proof.toMonitor,
          afterArranged: false,
          fromMonitor: proof.fromMonitor,
          toMonitor: proof.toMonitor,
          moveDirection: proof.moveDirection,
          moveConfirmed: true,
          twoDisplayLayoutConfirmed: proof.twoDisplayLayoutConfirmed,
        },
      };
      break;
    case "state":
      evidence = {
        kind: "window",
        profile: "legacy-window-v1",
        result: {
          app: "ordinary-window",
          operation: proof.action,
          before: { state: proof.before, arranged: proof.beforeArranged },
          after: { state: proof.after },
          moving: false,
          elevated: false,
          targetMatched: true,
          inputAgeMs: proof.inputAgeMs,
          monitor: proof.monitor,
          afterArranged: proof.afterArranged,
          fromMonitor: proof.monitor,
          toMonitor: proof.monitor,
          moveDirection: null,
        },
      };
      break;
    case "placement":
      evidence = {
        ...proof,
        kind: "placement",
        profile: "placement-v1",
        targetMatched: true,
        monitorChanged: false,
      };
      break;
    case "close":
      evidence = {
        ...proof,
        kind: "window-close",
        profile: "window-close-v1",
        targetMatched: true,
      };
      break;
    case "taskbar":
      evidence = {
        ...proof,
        kind: "taskbar-input",
        profile: "taskbar-input-v1",
      };
      break;
  }
  return { ...base, route: proof.route, evidence };
}

// Common inputs only: new partial adoption/monitor-changing placement is intentional
// and is covered separately by the independent protocol/persistence suites.
test("all eight operations retain Observation and shortcut parity across evidence formats", () => {
  for (const proof of independentProofs) {
    const current = classifyGesture(independentFixture([proof]));
    assert.equal(current.length, 1, proof.kind);
    assert.deepEqual(classifyGesture(legacy(proof)), current, proof.kind);
    assert.deepEqual(classify(legacy(proof)), current[0], proof.kind);
    assert.equal(classify(independentFixture([proof])), null);
  }
});

test("W02 uncertain direction records without guidance in both formats", () => {
  const proof = independentProofs.find((p) => p.kind === "monitor-move");
  assert.ok(proof?.kind === "monitor-move");
  const unknown = {
    ...proof,
    moveDirection: null,
    twoDisplayLayoutConfirmed: false,
  };
  const observations = classifyGesture(independentFixture([unknown]));
  assert.equal(observations[0]?.operation, "W02");
  assert.equal(observations[0]?.shortcut, null);
  assert.deepEqual(classifyGesture(legacy(unknown)), observations);
});

test("caption and drag compounds preserve ordered observations and single-entry compatibility", () => {
  const base = independentFixture();
  const switchProof = independentProofs[0];
  const move = independentProofs.find((p) => p.kind === "monitor-move");
  const state = independentProofs.find(
    (p) => p.kind === "state" && p.action === "maximize",
  );
  assert.ok(move?.kind === "monitor-move" && state?.kind === "state");
  const caption: CandidateV2 = {
    ...base,
    route: "inactive-caption-click",
    evidence: {
      kind: "caption-click",
      profile: "caption-click-v1",
      terminal: "maximized",
      switched: true,
      targetMatched: true,
      released: true,
      inputAgeMs: 200,
      monitor: state.monitor,
    },
  };
  const drag: CandidateV2 = {
    ...base,
    route: "compound-caption-drag",
    evidence: {
      kind: "compound-drag",
      profile: "compound-drag-v1",
      terminal: "maximized",
      targetMatched: true,
      released: true,
      layoutStable: true,
      inputAgeMs: 200,
      fromMonitor: move.fromMonitor,
      toMonitor: move.toMonitor,
      moveDirection: move.moveDirection,
      terminalEquivalent: true,
      twoDisplayLayoutConfirmed: true,
    },
  };
  assert.deepEqual(
    classifyGesture(caption),
    classifyGesture(independentFixture([switchProof, state])),
  );
  assert.deepEqual(
    classifyGesture(drag),
    classifyGesture(
      independentFixture([move, { ...state, monitor: move.toMonitor }]),
    ),
  );
  for (const value of [caption, drag]) {
    assert.equal(classify(value), null);
    assert.deepEqual(classifyGesture({ ...value, injected: true }), []);
  }
});
