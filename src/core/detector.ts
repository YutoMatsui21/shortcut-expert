import type { ObserverCandidate, Observation } from "../shared/coach.ts";
import { classifyCaptionClick } from "./detection/caption-click.ts";
import { classifyCompoundDrag } from "./detection/compound-drag.ts";
import { classifyPlacement } from "./detection/placement.ts";
import { classifyTaskbarInput } from "./detection/taskbar-input.ts";
import { classifyWindowClose } from "./detection/window-close.ts";
import { classifyWindowSwitch } from "./detection/window-switch.ts";
import { classifyWindow } from "./detection/window.ts";
import { classifyIndependent } from "./independent-detector.ts";

// Public compatibility entrances retain the legacy single/compound distinction.
export function classifyGesture(value: ObserverCandidate): Observation[] {
  if (value.protocolVersion !== 2) return [];
  const evidence = value.evidence;
  switch (evidence.kind) {
    case "independent-results":
      return classifyIndependent(value);
    case "caption-click":
      return classifyCaptionClick({ ...value, evidence });
    case "compound-drag":
      return classifyCompoundDrag({ ...value, evidence });
    default: {
      const single = classify(value);
      return single ? [single] : [];
    }
  }
}

export function classify(value: ObserverCandidate): Observation | null {
  if (value.protocolVersion !== 2) return null;
  const evidence = value.evidence;
  switch (evidence.kind) {
    case "window-close":
      return classifyWindowClose({ ...value, evidence });
    case "placement":
      return classifyPlacement({ ...value, evidence });
    case "window-switch":
      return classifyWindowSwitch({ ...value, evidence });
    case "taskbar-input":
      return classifyTaskbarInput({ ...value, evidence });
    case "window":
      return classifyWindow({ ...value, evidence });
    // Historical/unverified evidence and gesture-only formats remain unsupported here.
    default:
      return null;
  }
}
