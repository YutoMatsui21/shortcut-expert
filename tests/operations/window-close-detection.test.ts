import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../../src/core/detector.ts';
mock.module('electron', { namedExports: { app: {} } });
const { candidateV2 } = await import('../../src/main/observer.ts');
const input = () => ({ type: 'candidate', protocolVersion: 2, generation: 1, sequence: 1, transaction: 7,
  date: '2026-10-29', origin: 'mouse', route: 'close-button', injected: false, conflicted: false,
  evidence: { kind: 'window-close', profile: 'window-close-v1', targetMatched: true, destroyed: true,
    inputAgeMs: 200, monitor: { x: 0, y: 0, width: 1920, height: 1080 } } });
test('verified window close has no app allowlist and uses one transaction for W11', () => {
  for (const origin of ['mouse', 'key']) {
    const parsed = candidateV2({ ...input(), origin, route: origin === 'mouse' ? 'close-button' : 'alt-f4' });
    assert.ok(parsed);
    assert.deepEqual(classify(parsed), { id: '1:t7', operation: 'W11', origin, date: '2026-10-29',
      shortcut: 'Alt + F4', monitor: input().evidence.monitor });
  }
});
test('close rejects missing/invalid evidence and unconfirmed, expired, mixed routes', () => {
  for (const field of ['profile', 'targetMatched', 'destroyed', 'inputAgeMs', 'monitor']) {
    const value = input(); const evidence: Record<string, unknown> = { ...value.evidence }; delete evidence[field];
    assert.equal(candidateV2({ ...value, evidence }), null, field);
  }
  for (const patch of [{ targetMatched: false }, { destroyed: false }, { inputAgeMs: 1001 }]) {
    const value = input(); const parsed = candidateV2({ ...value, evidence: { ...value.evidence, ...patch } });
    assert.ok(parsed); assert.equal(classify(parsed), null);
  }
  for (const patch of [{ injected: true }, { conflicted: true }, { route: 'direct-click' }, { origin: 'unknown' }]) {
    const parsed = candidateV2({ ...input(), ...patch }); assert.ok(parsed); assert.equal(classify(parsed), null);
  }
  for (const inputAgeMs of [-1, NaN, Infinity]) {
    const value = input(); assert.equal(candidateV2({ ...value, evidence: { ...value.evidence, inputAgeMs } }), null);
  }
});
