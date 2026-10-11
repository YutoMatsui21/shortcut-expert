import type { Candidate, Observation } from '../shared/coach.ts';
import { validDate } from './dates.ts';

export function classify(candidate: Candidate): Observation | null {
  if (!validDate(candidate.date) || !Number.isSafeInteger(candidate.sequence) || candidate.sequence < 1 ||
      !['chrome', 'obsidian', 'code', 'chatgpt'].includes(candidate.app) ||
      candidate.operation !== 'maximize' || candidate.before.state !== 'normal' ||
      candidate.before.arranged === null || candidate.after.state !== 'maximized' ||
      candidate.elevated !== false || candidate.injected || candidate.conflicted || candidate.moving || !candidate.targetMatched ||
      candidate.inputAgeMs < 0 || candidate.inputAgeMs > 1000 ||
      !((candidate.origin === 'mouse' && ['max-button', 'caption-double-click'].includes(candidate.route)) ||
        (candidate.origin === 'key' && candidate.route === 'win-up'))) return null;
  return {
    id: `${candidate.generation}:${candidate.sequence}`, operation: 'W03',
    origin: candidate.origin === 'key' ? 'key' : 'mouse', date: candidate.date,
    shortcut: candidate.before.arranged ? null : 'Win + ↑', monitor: candidate.monitor
  };
}
