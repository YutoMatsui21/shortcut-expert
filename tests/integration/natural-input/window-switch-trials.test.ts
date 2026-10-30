import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NaturalInputTrials } from '../src/main/natural-input-acceptance.ts';
import type { Snapshot } from '../src/shared/coach.ts';

test('W01 manual trial enforces scenario, Alt+Tab guidance and W12 coexistence independently', async () => {
  for (const scenario of ['direct', 'alt-tab', 'multi-tab', 'escape', 'taskbar-click', 'win-digit']) {
    const snapshot: Snapshot = { counts: {}, settings: { muted: [], opened: true }, observing: false,
      notificationsPaused: false, error: null, pendingSave: false };
    const trials = new NaturalInputTrials({ snapshot: () => snapshot, idle: async () => {},
      configure: async state => { snapshot.settings.states = { W01: state }; },
      start: async () => { snapshot.observing = true; }, stop: async () => { snapshot.observing = false; } }, 'W01');
    const kind = scenario === 'direct' ? 'mouse' : ['alt-tab', 'multi-tab'].includes(scenario) ? 'key' : 'negative';
    const plan = { kind, application: 'standard', state: 'learning', paused: false, scenario };
    await assert.rejects(trials.arm({ ...plan, scenario: 'private title' }));
    await assert.rejects(trials.arm({ ...plan, scenario: undefined }));
    await trials.arm(plan);
    snapshot.counts['2026-10-21'] = { W01: { mouse: kind === 'mouse' ? 1 : 0, key: kind === 'key' ? 1 : 0 },
      W12: { mouse: scenario === 'taskbar-click' ? 1 : 0, key: scenario === 'win-digit' ? 1 : 0 } };
    if (kind === 'mouse') trials.noticeRequested('W01', 'Alt + Tab');
    await trials.finish(true);
    const result = trials.results[0] as { detectorPassed: boolean; notificationRequestPassed: boolean; coexistencePassed: boolean };
    assert.deepEqual([result.detectorPassed, result.notificationRequestPassed, result.coexistencePassed], [true, true, true]);
    await trials.arm(plan);
    snapshot.counts['2026-10-21'].W01!.mouse++;
    snapshot.counts['2026-10-21'].W12!.key += 2;
    trials.noticeRequested('W01', 'Win + 1'); await trials.finish(true);
    const wrong = trials.results[1] as typeof result;
    assert.equal(wrong.notificationRequestPassed, false); assert.equal(wrong.coexistencePassed, false);
  }
});
