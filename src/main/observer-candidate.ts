import {
  independentCandidate,
  usesIndependentResults,
} from "../core/independent-results.ts";
import type { CandidateV2, Evidence } from "../shared/coach";
import {
  boolean,
  fields,
  milliseconds,
  nullableBoolean,
  nullableBounds,
  oneOf,
  protocolId,
  record,
  slotUpTo,
  string,
  type Fields,
} from "./observer-fields.ts";
import {
  captionClick,
  compoundDrag,
  placement,
  windowEvidence,
} from "./observer-window-evidence.ts";

type CompatibleEvidence = Exclude<Evidence, { kind: "independent-results" }>;
type EvidenceReaders = {
  [K in CompatibleEvidence["kind"]]: (
    value: Fields,
  ) => Extract<CompatibleEvidence, { kind: K }> | undefined;
};

const evidenceReaders: EvidenceReaders = {
  "caption-click": captionClick,
  "compound-drag": compoundDrag,
  placement,
  window: windowEvidence,
  "window-close": fields({
    kind: oneOf("window-close"),
    profile: oneOf("window-close-v1"),
    targetMatched: boolean,
    destroyed: boolean,
    inputAgeMs: milliseconds,
    monitor: nullableBounds,
  }),
  "window-switch": fields({
    kind: oneOf("window-switch"),
    profile: oneOf("window-switch-v1"),
    windowsDifferent: boolean,
    eligible: boolean,
    inputTargetMatched: boolean,
    foregroundMatched: boolean,
    inputAgeMs: milliseconds,
    settleMs: milliseconds,
    monitor: nullableBounds,
  }),
  "taskbar-input": fields({
    kind: oneOf("taskbar-input"),
    profile: oneOf("taskbar-input-v1"),
    slot: slotUpTo(10),
    mappingConfirmed: boolean,
    snapshotAgeMs: milliseconds,
    confirmationAgeMs: milliseconds,
    monitor: nullableBounds,
  }),
  "snap-invocation": fields({
    kind: oneOf("snap-invocation"),
    profile: oneOf("snap-invocation-v1"),
    targetMatched: boolean,
    eligible: boolean,
    settingsEnabled: nullableBoolean,
    buttonSource: oneOf(null, "title-rect", "hit-fallback"),
    dwellMs: milliseconds,
    inputAgeMs: milliseconds,
    monitor: nullableBounds,
  }),
  "shell-display": fields({
    kind: oneOf("shell-display"),
    profile: oneOf("unverified"),
    feature: oneOf("task-view", "snap-layout"),
    wasVisible: nullableBoolean,
    visible: nullableBoolean,
    targetMatched: nullableBoolean,
  }),
  activation: fields({
    kind: oneOf("activation"),
    profile: oneOf("unverified"),
    slot: slotUpTo(9),
    appMatched: nullableBoolean,
    targetMatched: nullableBoolean,
    individualEquivalent: nullableBoolean,
    result: oneOf("launched", "activated", "unknown"),
  }),
  global: fields({
    kind: oneOf("global"),
    profile: oneOf("unverified"),
    feature: oneOf("desktop", "minimize-all"),
    targetsKnown: nullableBoolean,
    resultConfirmed: nullableBoolean,
  }),
};

function isEvidenceKind(kind: unknown): kind is keyof EvidenceReaders {
  return typeof kind === "string" && Object.hasOwn(evidenceReaders, kind);
}

function evidence(value: unknown): Evidence | undefined {
  if (!record(value) || !isEvidenceKind(value.kind)) return undefined;
  return evidenceReaders[value.kind](value);
}

function id(value: unknown): number | undefined {
  return protocolId(value) ? value : undefined;
}

function route(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 64 ? value : undefined;
}

const compatibleCandidate = fields<CandidateV2>({
  type: oneOf("candidate"),
  protocolVersion: oneOf(2),
  generation: id,
  sequence: id,
  transaction: id,
  date: string,
  origin: oneOf("mouse", "key", "unknown"),
  route,
  injected: boolean,
  conflicted: boolean,
  evidence,
});

export function candidateV2(value: unknown): CandidateV2 | null {
  if (!record(value)) return null;
  if (usesIndependentResults(value)) return independentCandidate(value);
  return compatibleCandidate(value) ?? null;
}
