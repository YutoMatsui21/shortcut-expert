import type { DurableCoach } from '../core/durable-coach';
import { localDate } from '../core/dates.ts';
import type { Candidate } from '../shared/coach';
import type { ObserverClient } from './observer';

// Explicitly opted-in NSIS acceptance: artificial input, real storage and OS adapter.
// ObserverClient is created in fixture mode, so hooks never read real input payloads.
export async function runNotificationAcceptance(coach: DurableCoach,
  observer: Pick<ObserverClient, 'stop' | 'start' | 'inject'>,
  wait: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 3000))): Promise<void> {
  coach.stop(); await observer.stop();
  const generation = await observer.start(); coach.begin(generation);
  coach.pauseNotifications(false);
  await coach.setLearningState('W03', 'learning');
  await coach.setLearningState('W04', 'learning');
  const today = localDate();
  const before = coach.snapshot().counts[today];
  const sample: Candidate = { type: 'candidate', protocolVersion: 1, generation, sequence: 1,
    app: 'chrome', operation: 'maximize', date: today, before: { state: 'normal', arranged: false },
    after: { state: 'maximized' }, origin: 'mouse', route: 'max-button', injected: false,
    conflicted: false, moving: false, elevated: false, targetMatched: true, inputAgeMs: 100, monitor: null };
  for (let sequence = 1; sequence <= 3; sequence++) {
    await wait();
    await observer.inject(sequence < 3 ? { ...sample, sequence } : { ...sample, sequence,
      operation: 'restore', before: { state: 'maximized', arranged: false }, after: { state: 'normal' }, afterArranged: false });
    await coach.idle();
    if (coach.snapshot().error) throw new Error('V01 fixture storage failed');
  }
  const after = coach.snapshot().counts[today];
  if ((after?.W03?.mouse ?? 0) - (before?.W03?.mouse ?? 0) !== 2 ||
      (after?.W04?.mouse ?? 0) - (before?.W04?.mouse ?? 0) !== 1) throw new Error('V01 fixture counts mismatch');
  console.log('V01_FIXTURE_COMMITTED ' + JSON.stringify({ W03: 2, W04: 1, osDisplay: 'manual-verification-required' }));
}
