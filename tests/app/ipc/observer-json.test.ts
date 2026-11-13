import assert from "node:assert/strict";
import { test } from "node:test";
import { parseObserverMessage } from "../../../src/main/observer-json.ts";

void test("scanner retains overwritten and escaped discriminators while ignoring quoted punctuation", () => {
  for (const line of [
    '{"route":"independent-results","route":"legacy"}',
    '{"evidence":{"kind":"independent-results"},"evidence":{"kind":"window"}}',
    '{"evidence":{"prof\\u0069le":"independent-results-v1","profile":"legacy"}}',
    '{"evidence":{"kind":"independent-results","note":"\\\"{}[],:","note":"last"}}',
  ])
    assert.throws(() => parseObserverMessage(line), /json-duplicate/);
  const quoted = '{"route":"independent-results","note":"\\\"{}[],:"}';
  assert.deepEqual(parseObserverMessage(quoted), JSON.parse(quoted));
});

void test("duplicate scopes and discriminator paths stay separate for legacy messages", () => {
  for (const line of [
    '{"left":{"x":1},"right":{"x":2}}',
    '{"nested":{"route":"independent-results"},"x":1,"x":2}',
    '{"evidence/kind":"independent-results","x":1,"x":2}',
    '{"evidence":{"nested":{"kind":"independent-results"}},"x":1,"x":2}',
    '[{"route":"independent-results","x":1,"x":2}]',
  ])
    assert.deepEqual(parseObserverMessage(line), JSON.parse(line));
});

void test("scanner leaves deep legacy JSON and malformed syntax decisions to JSON.parse", () => {
  const deep = "[".repeat(4000) + "0" + "]".repeat(4000);
  assert.doesNotThrow(() => parseObserverMessage(deep));
  for (const line of [
    '{"x":}',
    '{"x":"unterminated}',
    '{"x":"bad\\q"}',
    '{"x":1} trailing',
  ])
    assert.throws(() => parseObserverMessage(line));
});
