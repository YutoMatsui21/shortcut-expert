import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test, mock } from "node:test";
import { deferred } from "../../support/fixtures.ts";

test("activation initialization failure reports an error and exits without starting observation", async () => {
  const exited = deferred<void>();
  const errors: string[] = [];
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    getPath: () => "fixture-user-data",
    setPath: () => {},
    requestSingleInstanceLock: () => true,
    whenReady: async () => {},
    setAppUserModelId: () => {},
    exit: (code: number) => {
      assert.equal(code, 1);
      exited.resolve();
    },
  });
  mock.module("electron", {
    namedExports: {
      app,
      dialog: { showErrorBox: (title: string) => errors.push(title) },
      Notification: class {
        constructor() {
          throw new Error("fixture presenter unavailable");
        }
        static handleActivation() {}
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
      runCoach: () =>
        assert.fail("failed initialization cannot start observation"),
      showCoach: () => {},
    },
  });
  await import("../../../src/main/index.ts");
  await exited.promise;
  assert.deepEqual(errors, ["起動できません"]);
});
