import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, type BrowserWindow } from "electron";
import { localDate } from "../core/dates";
import type { DurableCoach } from "../core/durable-coach";
import type { CoachBridge, CandidateV2 } from "../shared/coach";
import { waitForLearning, selectPage } from "./learning-smoke";
import { SqliteRepository } from "./sqlite-repository";

export async function runDeleteSmoke(
  window: BrowserWindow,
  coach: DurableCoach,
  command: CoachBridge["command"],
  repository: SqliteRepository,
) {
  const js = (source: string) => window.webContents.executeJavaScript(source);
  const key = async (keyCode: string, modifiers: "shift"[] = []) => {
    window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  };
  const open = async () => {
    await js(`document.querySelector('.gear-button').click()`);
    await waitForLearning(
      window,
      `!!document.querySelector('.settings-delete')`,
    );
    await js(`document.querySelector('.settings-delete').click()`);
    await waitForLearning(
      window,
      `document.querySelector('.delete-confirm')?.disabled === false`,
    );
    await waitForLearning(
      window,
      `document.activeElement === document.querySelector('.delete-cancel')`,
    );
  };
  const closed = () =>
    waitForLearning(
      window,
      `!document.querySelector('.delete-dialog') && document.activeElement === document.querySelector('.gear-button')`,
    );
  window.show();
  window.focus();
  await waitForLearning(window, "document.hasFocus()");
  await selectPage(window, "記録");
  await js(`window.coach.setLearningState('W03','mastered')`);
  coach.begin(800);
  const sample: CandidateV2 = {
    type: "candidate",
    protocolVersion: 2,
    generation: 800,
    sequence: 1,
    transaction: 1,
    date: localDate(),
    origin: "key",
    route: "win-up",
    injected: false,
    conflicted: false,
    evidence: {
      kind: "window",
      profile: "legacy-window-v1",
      result: {
        app: "chrome",
        operation: "maximize",
        before: { state: "normal", arranged: false },
        after: { state: "maximized" },
        moving: false,
        elevated: false,
        targetMatched: true,
        inputAgeMs: 100,
        monitor: null,
        afterArranged: null,
        fromMonitor: null,
        toMonitor: null,
        moveDirection: null,
      },
    },
  };
  await coach.accept(sample);
  for (const width of [800, 920, 1120, 1360]) {
    window.setContentSize(width, 600);
    await waitForLearning(window, `Math.abs(innerWidth - ${width}) <= 1`);
    await open();
    const geometry = await js(
      `(() => {const r=document.querySelector('.delete-dialog').getBoundingClientRect();return {width:r.width,height:r.height,x:r.x,y:r.y,right:r.right};})()`,
    );
    assert.equal(geometry.width, 440);
    assert.equal(geometry.height, 218);
    assert.ok(geometry.x >= 0 && geometry.right <= width && geometry.y >= 0);
    await writeFile(
      join(app.getPath("userData"), `delete-${width}.png`),
      (await window.webContents.capturePage()).toPNG(),
    );
    await key("Tab");
    await waitForLearning(
      window,
      `document.activeElement === document.querySelector('.delete-confirm')`,
    );
    await key("Tab");
    await waitForLearning(
      window,
      `document.activeElement === document.querySelector('.delete-cancel')`,
    );
    await key("Tab", ["shift"]);
    await waitForLearning(
      window,
      `document.activeElement === document.querySelector('.delete-confirm')`,
    );
    await key("Escape");
    await closed();
  }
  await open();
  await coach.accept({ ...sample, sequence: 2, transaction: 2 });
  assert.equal(coach.snapshot().observing, true);
  assert.equal(
    coach.snapshot().counts[localDate()].W03?.key,
    2,
    "observation continues until confirmed",
  );
  await js(`document.querySelector('.delete-cancel').click()`);
  await closed();
  assert.equal(coach.snapshot().counts[localDate()].W03?.key, 2);
  const before = await repository.load(localDate());
  await open();
  await js(
    `document.querySelector('.delete-confirm').click();document.querySelector('.delete-confirm')?.click()`,
  );
  await closed();
  assert.equal(coach.snapshot().observing, true);
  assert.equal(coach.snapshot().error, null);
  assert.deepEqual(coach.snapshot().counts, {});
  assert.equal((await repository.load(localDate())).epoch, before.epoch + 1);
  assert.deepEqual(coach.snapshot().settings, before.settings);
  await coach.accept({ ...sample, sequence: 3, transaction: 3 });
  assert.deepEqual(
    coach.snapshot().counts,
    {},
    "old generation cannot restore counts",
  );
  // A failed reset must return error/retry, and retry must resume the prior observation state.
  const commit = repository.commit.bind(repository);
  repository.commit = async (value) => {
    if (value.reset) throw new Error("fixture reset failure");
    await commit(value);
  };
  try {
    await open();
    await js(`document.querySelector('.delete-confirm').click()`);
    await closed();
    assert.equal(coach.snapshot().observing, false);
    assert.equal(coach.snapshot().pendingSave, true);
    assert.ok(coach.snapshot().error);
    repository.commit = commit;
    await command("retry-save");
    assert.equal(coach.snapshot().pendingSave, false);
    assert.equal(coach.snapshot().observing, true);
  } finally {
    repository.commit = commit;
  }
  await command("stop");
  await open();
  await js(`document.querySelector('.delete-confirm').click()`);
  await closed();
  assert.equal(coach.snapshot().observing, false, "stopped stays stopped");
  await command("start");
  return {
    deleteDialog: true,
    deleteWidths: [800, 920, 1120, 1360],
    deleteKeyboard: true,
    deleteGeneration: true,
    deleteRetry: true,
  };
}
