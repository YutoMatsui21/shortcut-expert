import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";
test("taskbar production query transport bounds blocked providers, reuses and restarts its isolated worker", () => {
  const result = spawnSync(
    resolve("resources/native-helper/WindowObserver.exe"),
    ["--taskbar-query-self-test"],
    { encoding: "utf8", timeout: 15000, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    first: true,
    reused: true,
    timeout: true,
    restarted: true,
    stopped: true,
    globalInputCollected: false,
  });
});
