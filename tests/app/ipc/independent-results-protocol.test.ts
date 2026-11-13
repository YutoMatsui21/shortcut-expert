import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { classifyGesture } from "../../../src/core/detector.ts";
mock.module("electron", { namedExports: { app: {} } });
const { candidateV2 } = await import("../../../src/main/observer.ts");
const monitor = { x: 0, y: 0, width: 1920, height: 1080 };
const proofs: Record<string, unknown>[] = [
  {
    kind: "switch",
    route: "direct-click",
    windowsDifferent: true,
    eligible: true,
    foregroundMatched: true,
    inputAgeMs: 200,
    settleMs: 100,
    monitor: null,
  },
  {
    kind: "monitor-move",
    route: "caption-drag",
    moveConfirmed: true,
    layoutStable: true,
    inputAgeMs: 200,
    fromMonitor: monitor,
    toMonitor: { ...monitor, x: 1920 },
    moveDirection: "right",
    twoDisplayLayoutConfirmed: true,
  },
  {
    kind: "state",
    route: "max-button",
    action: "maximize",
    before: "normal",
    after: "maximized",
    beforeArranged: false,
    afterArranged: null,
    inputAgeMs: 200,
    monitor: null,
  },
  {
    kind: "placement",
    route: "caption-edge-drag",
    shape: "left-half",
    placementConfirmed: true,
    layoutStable: true,
    inputAgeMs: 200,
    monitor,
  },
  {
    kind: "close",
    route: "close-button",
    destroyed: true,
    inputAgeMs: 200,
    monitor: null,
  },
  {
    kind: "taskbar",
    route: "taskbar-click",
    slot: 10,
    mappingConfirmed: true,
    snapshotAgeMs: 750,
    confirmationAgeMs: 2500,
    monitor: null,
  },
];
function envelope(results = proofs, origin = "mouse") {
  return {
    type: "candidate",
    protocolVersion: 2,
    generation: 1,
    sequence: 2,
    transaction: 3,
    date: "2024-02-29",
    origin,
    route: "independent-results",
    injected: false,
    conflicted: false,
    evidence: {
      kind: "independent-results",
      profile: "independent-results-v1",
      targetMatched: true,
      released: true,
      final: true,
      results,
    },
  };
}
function accepts(proof: Record<string, unknown>, origin = "mouse") {
  return candidateV2(envelope([proof], origin));
}
test("independent results classify 1/2/3+ proofs in canonical operation order", () => {
  for (const [results, operations] of [
    [[proofs[0]], ["W01"]],
    [
      [proofs[1], proofs[3]],
      ["W02", "W06"],
    ],
    [proofs.slice(0, 3), ["W01", "W02", "W03"]],
    [proofs, ["W01", "W02", "W03", "W06", "W11", "W12"]],
  ] as const) {
    const parsed = candidateV2(envelope([...results]));
    assert.ok(parsed);
    assert.deepEqual(
      classifyGesture(parsed).map((o) => o.operation),
      operations,
    );
  }
});
test("strict keys are required at envelope/evidence/proof/Bounds levels", () => {
  const sample = envelope();
  const objects = [
    sample,
    sample.evidence,
    ...sample.evidence.results,
    monitor,
  ];
  for (let index = 0; index < objects.length; index++) {
    for (const key of [
      ...Object.keys(objects[index]),
      "title",
      "pid",
      "shortcut",
      "__proto__",
    ]) {
      const input = structuredClone(sample);
      const targets: Record<string, unknown>[] = [
        input,
        input.evidence,
        ...input.evidence.results,
        input.evidence.results[3].monitor as Record<string, unknown>,
      ];
      if (Object.hasOwn(objects[index], key)) delete targets[index][key];
      else
        Object.defineProperty(targets[index], key, {
          value: "forbidden",
          enumerable: true,
        });
      assert.equal(candidateV2(input), null, `${index}:${key}`);
    }
  }
});
test("invalid proof rejects whole envelope and never salvages siblings", () => {
  for (const patch of [
    { kind: "unknown" },
    { route: "alt-tab" },
    { windowsDifferent: false },
    { eligible: false },
    { foregroundMatched: false },
    { inputAgeMs: "200" },
    { inputAgeMs: -1 },
    { inputAgeMs: 0.5 },
    { inputAgeMs: 1501 },
    { settleMs: 201 },
    { monitor: { ...monitor, width: 0 } },
  ]) {
    assert.equal(
      candidateV2(envelope([{ ...proofs[0], ...patch }, proofs[3]])),
      null,
    );
  }
  for (const patch of [
    { results: [] },
    { profile: "future" },
    { final: false },
    { released: false },
    { targetMatched: false },
  ])
    assert.equal(
      candidateV2({
        ...envelope(),
        evidence: { ...envelope().evidence, ...patch },
      }),
      null,
    );
  for (const patch of [
    { generation: 0 },
    { sequence: 2147483648 },
    { transaction: 1.5 },
    { origin: "unknown" },
    { route: "direct-click" },
    { injected: true },
    { conflicted: true },
    { date: "2025-02-29" },
    { date: "2024-2-29" },
  ])
    assert.equal(candidateV2({ ...envelope(), ...patch }), null);
});
test("all legal routes preserve origin and state transition requirements", () => {
  const cases: [number, string, string, Record<string, unknown>][] = [
    [0, "alt-tab", "key", { settleMs: 250, inputAgeMs: 250 }],
    [
      1,
      "win-shift-left",
      "key",
      { toMonitor: { ...monitor, x: -1920 }, moveDirection: "left" },
    ],
    [1, "win-shift-right", "key", {}],
    ...[
      "max-button",
      "caption-double-click",
      "caption-top-drag",
      "mouse-state-fallback",
    ].map(
      (route) =>
        [2, route, "mouse", {}] as [
          number,
          string,
          string,
          Record<string, unknown>,
        ],
    ),
    [2, "win-up", "key", { beforeArranged: null }],
    ...["max-button", "caption-double-click", "mouse-state-fallback"].map(
      (route) =>
        [
          2,
          route,
          "mouse",
          {
            action: "restore",
            before: "maximized",
            after: "normal",
            afterArranged: false,
          },
        ] as [number, string, string, Record<string, unknown>],
    ),
    [
      2,
      "win-down",
      "key",
      {
        action: "restore",
        before: "maximized",
        after: "normal",
        afterArranged: false,
      },
    ],
    [2, "min-button", "mouse", { action: "minimize", after: "minimized" }],
    [
      2,
      "mouse-state-fallback",
      "mouse",
      { action: "minimize", after: "minimized" },
    ],
    [2, "win-down", "key", { action: "minimize", after: "minimized" }],
    [3, "win-held-arrows", "key", {}],
    [4, "alt-f4", "key", {}],
    [5, "win-digit", "key", {}],
  ];
  for (const [index, route, origin, patch] of cases) {
    const proof = { ...proofs[index], route, ...patch };
    const candidate = accepts(proof, origin);
    assert.ok(candidate, JSON.stringify(proof));
    const observations = classifyGesture(candidate);
    assert.equal(observations.length, 1);
    assert.equal(observations[0].origin, origin);
    assert.equal(
      observations[0].operation,
      index === 2 && patch.action
        ? "W04"
        : ["W01", "W02", "W03", "W06", "W11", "W12"][index],
    );
    assert.equal(accepts(proof, origin === "mouse" ? "key" : "mouse"), null);
  }
  for (const proof of proofs) assert.ok(accepts(proof));
});

test("Core rejects invalid common input and conflicting proofs even without Main parsing", () => {
  const candidate = candidateV2(envelope());
  assert.ok(candidate);
  for (const patch of [
    { released: false },
    { final: false },
    { targetMatched: false },
    { results: [] },
    { results: [proofs[1], { ...proofs[1], moveDirection: "left" }] },
  ]) {
    const invalid: import("../../../src/shared/coach.ts").CandidateV2 =
      structuredClone(candidate);
    Object.assign(invalid.evidence, patch);
    assert.deepEqual(classifyGesture(invalid), []);
  }
  const duplicate = candidateV2(
    envelope([proofs[1], proofs[1], proofs[3]].reverse()),
  );
  assert.ok(duplicate);
  assert.deepEqual(
    classifyGesture(duplicate).map((o) => o.operation),
    ["W02", "W06"],
  );
});
test("integer age, slot and geometry boundaries are enforced", () => {
  for (const [index, origin, route, max, min] of [
    [0, "mouse", "direct-click", 1500, 0],
    [0, "key", "alt-tab", 15000, 250],
    [1, "mouse", "caption-drag", 1000, 0],
    [1, "key", "win-shift-right", 1000, 0],
    [2, "mouse", "max-button", 1000, 0],
    [2, "key", "win-up", 1000, 0],
    [2, "mouse", "mouse-state-fallback", 500, 0],
    [3, "mouse", "caption-edge-drag", 1000, 0],
    [3, "key", "win-held-arrows", 15000, 0],
    [4, "mouse", "close-button", 1000, 0],
    [4, "key", "alt-f4", 1000, 0],
  ] as const) {
    const proof = {
      ...proofs[index],
      route,
      ...(index === 0 ? { settleMs: min } : {}),
    };
    for (const inputAgeMs of [min, max])
      assert.ok(accepts({ ...proof, inputAgeMs }, origin));
    for (const inputAgeMs of [-1, 0.1, max + 1, Infinity, NaN])
      assert.equal(accepts({ ...proof, inputAgeMs }, origin), null);
  }
  for (const slot of [1, 10]) assert.ok(accepts({ ...proofs[5], slot }));
  for (const patch of [
    { slot: 0 },
    { slot: 11 },
    { slot: 1.1 },
    { snapshotAgeMs: 751 },
    { confirmationAgeMs: 2501 },
    { mappingConfirmed: false },
  ])
    assert.equal(accepts({ ...proofs[5], ...patch }), null);
  for (const shape of [
    "left-half",
    "right-half",
    "left-top",
    "right-top",
    "left-bottom",
    "right-bottom",
  ])
    assert.ok(accepts({ ...proofs[3], shape }));
  for (const patch of [
    { shape: "top-half" },
    { placementConfirmed: false },
    { layoutStable: false },
    { monitor: null },
  ])
    assert.equal(accepts({ ...proofs[3], ...patch }), null);
  assert.equal(accepts({ ...proofs[1], toMonitor: monitor }), null);
  assert.equal(accepts({ ...proofs[1], moveConfirmed: false }), null);
  assert.equal(accepts({ ...proofs[4], destroyed: false }), null);
  for (const patch of [
    { beforeArranged: null },
    { after: "normal" },
    { action: "restore" },
    { action: "minimize", after: "minimized", route: "caption-top-drag" },
  ])
    assert.equal(accepts({ ...proofs[2], ...patch }), null);
});

test("raw JSON duplicate keys reject at every level including escaped names", async () => {
  const { parseObserverMessage } =
    await import("../../../src/main/observer.ts");
  const line = JSON.stringify(envelope());
  assert.ok(candidateV2(parseObserverMessage(line)));
  for (const [from, to] of [
    ['"type":"candidate"', '"type":"candidate","type":"candidate"'],
    ['"final":true', '"final":false,"final":true'],
    ['"kind":"switch"', '"kind":"switch","kind":"switch"'],
    ['"width":1920', '"width":1,"width":1920'],
    ['"released":true', '"releas\\u0065d":false,"released":true'],
    ['"evidence":{', '"evidence":{},"evidence":{'],
    ['"generation":1', '"generation":0,"generation":1'],
  ])
    assert.throws(() => parseObserverMessage(line.replace(from, to)), from);
  assert.throws(() => parseObserverMessage(line + "x"));
  assert.throws(() =>
    parseObserverMessage("[".repeat(10000) + "]".repeat(10000)),
  );
  assert.ok(candidateV2(parseObserverMessage(line.padEnd(16384, " "))));
  assert.throws(() => parseObserverMessage(line.padEnd(16385, " ")));
  // A duplicate discriminator must not hide a new variant behind a legacy one.
  assert.throws(() =>
    parseObserverMessage(
      line.replace(
        '"kind":"independent-results"',
        '"kind":"independent-results","kind":"window"',
      ),
    ),
  );
  // Legacy duplicate-key behavior is retained.
  assert.deepEqual(
    parseObserverMessage(
      '{"type":"ready","protocolVersion":1,"protocolVersion":2}',
    ),
    { type: "ready", protocolVersion: 2 },
  );
});

test("proof order and exact duplicates normalize; conflicting categories reject the envelope", () => {
  const expected = candidateV2(envelope([proofs[0], proofs[1], proofs[3]]));
  const reordered = Object.fromEntries(Object.entries(proofs[1]).reverse());
  assert.deepEqual(
    candidateV2(envelope([proofs[3], reordered, proofs[0], proofs[1]])),
    expected,
  );
  for (const proof of proofs) {
    const patch =
      proof.kind === "state"
        ? { inputAgeMs: 201 }
        : proof.kind === "taskbar"
          ? { slot: 1 }
          : { inputAgeMs: 201 };
    assert.equal(candidateV2(envelope([proof, { ...proof, ...patch }])), null);
  }
});
