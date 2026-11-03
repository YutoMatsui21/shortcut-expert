import type { CoachBridge } from "../../shared/coach";

declare global {
  interface Window {
    coach: CoachBridge;
  }
}
