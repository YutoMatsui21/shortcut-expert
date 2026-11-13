import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test, mock } from "node:test";
import type { NotificationResult } from "../../../src/main/standard-notification.ts";

class FakeNotification extends EventEmitter {
  static all: FakeNotification[] = [];
  calls = 0;
  readonly options: Electron.NotificationConstructorOptions;
  constructor(options: Electron.NotificationConstructorOptions) {
    super();
    this.options = options;
    FakeNotification.all.push(this);
  }
  show() {
    this.calls++;
  }
}
mock.module("electron", { namedExports: { Notification: FakeNotification } });
const { StandardNotifications } =
  await import("../../../src/main/standard-notification.ts");
const value = {
  operation: "W03" as const,
  shortcut: "Win + ↑",
  label: "ウィンドウを最大化する",
};

test("three or more eligible items retain their list and display two lines plus remainder", async (t) => {
  FakeNotification.all = [];
  const adapter = new StandardNotifications(
    () => {},
    () => {},
  );
  t.after(() => adapter.dispose());
  for (const length of [1, 2, 3, 8]) {
    const items = Array.from({ length }, (_, i) => ({
      ...value,
      label: `操作${i}`,
    }));
    const notice = { ...items[0], items };
    await adapter.show(notice);
    const expected =
      length === 1
        ? items[0].label
        : [
            ...items
              .slice(0, 2)
              .map((item) => `${item.label}: ${item.shortcut}`),
            ...(length > 2 ? [`ほか${length - 2}件のショートカット`] : []),
          ].join("\n");
    assert.equal(FakeNotification.all.at(-1)!.options.body, expected);
    assert.equal(notice.items.length, length);
  }
});

test("N requests use separate silent instances and UUIDs; OS events are distinct from API return", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  FakeNotification.all = [];
  const results: NotificationResult[] = [];
  let clicks = 0;
  const adapter = new StandardNotifications(
    () => clicks++,
    (result) => results.push(result),
  );
  t.after(() => adapter.dispose());
  for (let i = 0; i < 3; i++) assert.equal(await adapter.show(value), true);
  assert.equal(new Set(FakeNotification.all.map((n) => n.options.id)).size, 3);
  assert.deepEqual(
    results.map((r) => r.status),
    Array.from({ length: 3 }, () => ["requested", "api-returned"]).flat(),
  );
  for (const n of FakeNotification.all) {
    assert.equal(n.calls, 1);
    assert.equal(n.options.title, value.shortcut);
    assert.equal(n.options.body, value.label);
    assert.equal(n.options.silent, true);
    assert.equal(n.options.timeoutType, "default");
  }
  const [first, second, third] = FakeNotification.all;
  first.emit("show");
  first.emit("close", { reason: "timedOut" });
  assert.equal(
    first.listenerCount("click"),
    1,
    "timeout does not remove history click handlers early",
  );
  first.emit("click");
  assert.equal(clicks, 1);
  assert.equal(first.listenerCount("click"), 0);
  second.emit("failed");
  assert.equal(second.listenerCount("click"), 0);
  t.mock.timers.tick(60_000);
  assert.equal(third.listenerCount("click"), 0);
  assert.equal(results.filter((r) => r.status === "show-event").length, 1);
  assert.equal(results.filter((r) => r.status === "failed").length, 1);
  assert.equal(results.filter((r) => r.status === "unknown").length, 1);
  assert.equal(FakeNotification.all.length, 3, "no automatic resend");
});

test("API throw and resource cap never replay or thin new requests", async (t) => {
  FakeNotification.all = [];
  const results: NotificationResult[] = [];
  const adapter = new StandardNotifications(
    () => {},
    (result) => results.push(result),
  );
  t.after(() => adapter.dispose());
  for (let i = 0; i < 260; i++) await adapter.show(value);
  assert.equal(FakeNotification.all.length, 260);
  assert.equal(
    FakeNotification.all.filter((n) => n.listenerCount("click")).length,
    256,
  );
  assert.equal(results.filter((r) => r.status === "unknown").length, 4);
  const failed = new StandardNotifications(
    () => {},
    (result) => results.push(result),
    () => {
      throw new Error("API");
    },
  );
  assert.equal(await failed.show(value), false);
  assert.equal(results.at(-1)?.status, "failed");
});
