import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { deferred } from "../../support/fixtures.ts";

test("manual cold startup requests the list without notification activation; repeat launch only restores the existing window", async () => {
  const started = deferred<void>(),
    initialized = deferred<void>();
  let displays = 0,
    runs = 0;
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    getPath: () => "fixture-user-data",
    setPath: () => {},
    requestSingleInstanceLock: () => true,
    whenReady: async () => {},
    setAppUserModelId: () => {},
    exit: () => assert.fail("unexpected exit"),
  });
  mock.module("electron", {
    namedExports: {
      app,
      dialog: {},
      Notification: class {
        static handleActivation() {} // A normal manual launch has no activation callback.
      },
    },
  });
  mock.module("node:fs", {
    namedExports: {
      mkdirSync: () => {},
      mkdtempSync: () => "fixture",
      readdirSync: () => [],
    },
  });
  mock.module("../../../src/main/coach-app.ts", {
    namedExports: {
      runCoach: async () => {
        runs++;
        started.resolve();
        await initialized.promise;
      },
      showCoach: () => displays++,
    },
  });
  await import("../../../src/main/index.ts");
  await started.promise;
  assert.equal(
    displays,
    1,
    "cold manual launch must request display before loading saved settings",
  );
  app.emit("second-instance", {}, ["--login-startup"], "");
  assert.equal(displays, 1, "duplicate sign-in entry must not show a window");
  app.emit("second-instance", {}, [], "");
  assert.equal(
    displays,
    2,
    "a launch during initialization requests the same window",
  );
  initialized.resolve();
  await Promise.resolve();
  app.emit("second-instance", {}, [], "");
  assert.equal(displays, 3);
  assert.equal(runs, 1, "repeat launch cannot create another observer");
});
