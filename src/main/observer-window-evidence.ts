import type { Evidence, WindowEvidenceResult } from "../shared/coach";
import {
  boolean,
  booleanFlag,
  bounds,
  fields,
  finite,
  milliseconds,
  moveDirection,
  nullableBoolean,
  nullableBounds,
  oneOf,
  record,
  string,
  type Fields,
} from "./observer-fields.ts";

const corners = [
  "left-top",
  "right-top",
  "left-bottom",
  "right-bottom",
] as const;

type WindowEvidence<K extends Evidence["kind"]> = Extract<
  Evidence,
  { kind: K }
>;

export const captionClick = fields<WindowEvidence<"caption-click">>({
  kind: oneOf("caption-click"),
  profile: oneOf("caption-click-v1"),
  terminal: oneOf(null, "maximized", "minimized"),
  switched: boolean,
  targetMatched: boolean,
  released: boolean,
  inputAgeMs: milliseconds,
  // This profile treats an absent or invalid monitor as unknown.
  monitor: (value) => bounds(value) ?? null,
});

const compoundDragFields = fields<
  Omit<WindowEvidence<"compound-drag">, "twoDisplayLayoutConfirmed">
>({
  kind: oneOf("compound-drag"),
  profile: oneOf("compound-drag-v1"),
  terminal: oneOf("maximized", ...corners),
  targetMatched: boolean,
  released: boolean,
  layoutStable: boolean,
  terminalEquivalent: boolean,
  inputAgeMs: milliseconds,
  fromMonitor: bounds,
  toMonitor: bounds,
  moveDirection,
});

export function compoundDrag(
  raw: Fields,
): WindowEvidence<"compound-drag"> | undefined {
  const result = compoundDragFields(raw);
  const confirmed = booleanFlag(raw, "twoDisplayLayoutConfirmed");
  if (!result || confirmed === undefined) return undefined;
  return confirmed === null
    ? result
    : { ...result, twoDisplayLayoutConfirmed: confirmed };
}

export const placement = fields<WindowEvidence<"placement">>({
  kind: oneOf("placement"),
  profile: oneOf("placement-v1"),
  shape: oneOf("left-half", "right-half", ...corners),
  targetMatched: boolean,
  inputAgeMs: milliseconds,
  monitorChanged: boolean,
  monitor: bounds,
});

const beforeState = fields<WindowEvidenceResult["before"]>({
  state: string,
  arranged: nullableBoolean,
});

const afterState = fields<WindowEvidenceResult["after"]>({ state: string });

function windowConfirmations(raw: Fields) {
  const moveConfirmed = booleanFlag(raw, "moveConfirmed");
  const twoDisplayLayoutConfirmed = booleanFlag(
    raw,
    "twoDisplayLayoutConfirmed",
  );
  if (moveConfirmed === undefined || twoDisplayLayoutConfirmed === undefined)
    return undefined;
  return {
    ...(moveConfirmed === null ? {} : { moveConfirmed }),
    ...(twoDisplayLayoutConfirmed === null
      ? {}
      : { twoDisplayLayoutConfirmed }),
  };
}

const windowResultFields = fields<
  Omit<WindowEvidenceResult, "moveConfirmed" | "twoDisplayLayoutConfirmed">
>({
  app: string,
  operation: string,
  before: beforeState,
  after: afterState,
  afterArranged: nullableBoolean,
  moving: boolean,
  elevated: boolean,
  targetMatched: boolean,
  inputAgeMs: finite,
  monitor: nullableBounds,
  fromMonitor: nullableBounds,
  toMonitor: nullableBounds,
  moveDirection,
});

function windowResult(value: unknown): WindowEvidenceResult | undefined {
  if (!record(value)) return undefined;
  const result = windowResultFields(value);
  const confirmations = windowConfirmations(value);
  if (!result || !confirmations) return undefined;
  return { ...result, ...confirmations };
}

export const windowEvidence = fields<WindowEvidence<"window">>({
  kind: oneOf("window"),
  profile: oneOf("legacy-window-v1", "unverified"),
  result: windowResult,
});
