import type { DurableCoach } from "../core/durable-coach";
import { localDate } from "../core/dates.ts";
import type { CandidateV2 } from "../shared/coach";
import type { ObserverClient } from "./observer";

// Explicitly opted-in NSIS acceptance: artificial input, real storage and OS adapter.
// ObserverClient is created in fixture mode, so hooks never read real input payloads.
export async function runNotificationAcceptance(
  coach: DurableCoach,
  observer: Pick<ObserverClient, "stop" | "start" | "inject">,
  wait: () => Promise<void> = () =>
    new Promise((resolve) => setTimeout(resolve, 3000)),
): Promise<void> {
  coach.stop();
  await observer.stop();
  const generation = await observer.start();
  coach.begin(generation);
  coach.pauseNotifications(false);
  await coach.setLearningState("W03", "learning");
  await coach.setLearningState("W04", "learning");
  const today = localDate();
  const before = coach.snapshot().counts[today];
  for (let sequence = 1; sequence <= 3; sequence++) {
    await wait();
    const sample: CandidateV2 = {
      type: "candidate",
      protocolVersion: 2,
      generation,
      sequence,
      transaction: sequence,
      date: today,
      origin: "mouse",
      route: "max-button",
      injected: false,
      conflicted: false,
      evidence: {
        kind: "window",
        profile: "legacy-window-v1",
        result: {
          app: "chrome",
          operation: sequence < 3 ? "maximize" : "restore",
          before: {
            state: sequence < 3 ? "normal" : "maximized",
            arranged: false,
          },
          after: { state: sequence < 3 ? "maximized" : "normal" },
          afterArranged: false,
          moving: false,
          elevated: false,
          targetMatched: true,
          inputAgeMs: 100,
          monitor: null,
          fromMonitor: null,
          toMonitor: null,
          moveDirection: null,
        },
      },
    };
    await observer.inject(sample);
    await coach.idle();
    if (coach.snapshot().error) throw new Error("V01 fixture storage failed");
  }
  const after = coach.snapshot().counts[today];
  if (
    (after?.W03?.mouse ?? 0) - (before?.W03?.mouse ?? 0) !== 2 ||
    (after?.W04?.mouse ?? 0) - (before?.W04?.mouse ?? 0) !== 1
  )
    throw new Error("V01 fixture counts mismatch");
  console.log(
    "V01_FIXTURE_COMMITTED " +
      JSON.stringify({
        W03: 2,
        W04: 1,
        osDisplay: "manual-verification-required",
      }),
  );
}
