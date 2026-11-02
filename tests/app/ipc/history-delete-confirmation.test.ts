import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeleteConfirmation } from '../../../src/main/delete-confirmation.ts';

test('confirmation is frame-bound, expires, cancels and is consumed before async deletion', () => {
  let now = 0;
  const gate = new DeleteConfirmation(() => now);
  const frame = {}, other = {};
  const first = gate.issue(frame);
  assert.throws(() => gate.consume(other, first), /confirmation/);
  gate.consume(frame, first);
  assert.throws(() => gate.consume(frame, first), /confirmation/);
  const cancelled = gate.issue(frame); gate.cancel(frame, cancelled);
  assert.throws(() => gate.consume(frame, cancelled), /confirmation/);
  const old = gate.issue(frame), current = gate.issue(frame);
  assert.throws(() => gate.consume(frame, old), /confirmation/);
  now = 300_000;
  assert.throws(() => gate.consume(frame, current), /confirmation/);
});
