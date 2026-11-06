import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test, mock } from "node:test";

test("a process losing the instance lock never initializes COM, a window or a helper", async () => {
  const exits: number[] = [];
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    getPath: () => "fixture-user-data",
    setPath: () => {},
    requestSingleInstanceLock: () => false,
    exit: (code: number) => exits.push(code),
    whenReady: () => assert.fail("losing process cannot initialize"),
    setAppUserModelId: () =>
      assert.fail("losing process cannot change identity"),
  });
  mock.module("electron", {
    namedExports: {
      app,
      dialog: {},
      Notification: class {
        constructor() {
          assert.fail("losing process cannot create a presenter");
        }
        static handleActivation() {
          assert.fail("losing process cannot register activation");
        }
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
      runCoach: () => assert.fail("losing process cannot start the app"),
      showCoach: () => assert.fail("losing process cannot show a window"),
    },
  });
  await import("../../../src/main/index.ts");
  assert.deepEqual(exits, [1]);
  assert.equal(app.listenerCount("second-instance"), 0);
});
