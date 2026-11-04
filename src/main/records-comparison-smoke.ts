import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, type BrowserWindow } from "electron";
import { localDate } from "../core/dates";
import { daysBefore, type RecordMutation } from "../shared/storage";
import { learningOperations } from "../shared/learning";
import type { SqliteRepository } from "./sqlite-repository";
import { selectPage, waitForLearning } from "./learning-smoke";

// Called only by --storage-smoke --comparison-smoke, before the fixture Coach is created.
export async function seedComparisonCoverage(repository: SqliteRepository) {
  const today = localDate(),
    state = await repository.load(today);
  let sequence = 0;
  // Complete coverage must be born observed; migration's unknown/gap is deliberately irreversible.
  for (const offset of [0, 7])
    for (const origin of ["mouse", "key"] as const) {
      const times =
        offset === 0 ? (origin === "key" ? 3 : 1) : origin === "mouse" ? 3 : 1;
      for (let i = 0; i < times; i++)
        await repository.commit({
          epoch: state.epoch,
          writeSession: repository.session,
          sequence: ++sequence,
          today,
          coverage: [],
          count: { day: daysBefore(today, offset), operation: "W03", origin },
        });
    }
  for (let offset = 0; offset < 60; offset++) {
    const day = daysBefore(today, offset),
      next = daysBefore(day, -1);
    const activeMs =
      new Date(next + "T00:00:00").getTime() -
      new Date(day + "T00:00:00").getTime();
    const coverage: RecordMutation["coverage"] = (["W03", "W12"] as const).map(
      (operation) => ({
        day,
        operation,
        value: {
          knowledge: "observed",
          activeMs,
          gap: false,
          capabilityRevision: "comparison-fixture",
        },
      }),
    );
    if (offset === 7)
      coverage.push({
        day,
        operation: "W02",
        value: {
          knowledge: "observed",
          activeMs: 1000,
          gap: true,
          capabilityRevision: "comparison-fixture",
        },
      });
    if (offset === 0)
      coverage.push({
        day,
        operation: "W04",
        value: {
          knowledge: "observed",
          activeMs: 1000,
          gap: true,
          capabilityRevision: "comparison-fixture",
        },
      });
    await repository.commit({
      epoch: state.epoch,
      writeSession: repository.session,
      sequence: ++sequence,
      today,
      coverage,
    });
  }
  await repository.saveSettings({
    opened: true,
    muted: [],
    states: Object.fromEntries(
      learningOperations.map((op) => [
        op.id,
        op.id === "W03"
          ? "learning"
          : op.id === "W12"
            ? "mastered"
            : "excluded",
      ]),
    ),
  });
}

export async function runRecordsComparisonSmoke(window: BrowserWindow) {
  window.show();
  window.focus();
  await selectPage(window, "記録");
  const ready = () =>
    waitForLearning(
      window,
      `document.querySelector('.records-scroll')?.getAttribute('aria-busy') === 'false'`,
    );
  const choose = async (label: string, value: string) => {
    await window.webContents.executeJavaScript(`(() => {
      const select = document.querySelector('.records-page select[aria-label=${JSON.stringify(label)}]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(value)});
      select.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    await ready();
  };
  const read = () =>
    window.webContents.executeJavaScript(`(() => {
    const text = selector => document.querySelector(selector)?.textContent;
    return {rate:text('[data-kpi="rate"]'),key:text('[data-kpi="key"]'),mouse:text('[data-kpi="mouse"]'),
      improvement:text('.record-usage [data-comparison]'),keyDifference:text('.record-counts dl > div:first-child [data-comparison]'),
      mouseDifference:text('.record-counts dl > div:last-child [data-comparison]'), info:document.querySelectorAll('.records-page .coverage-info').length,
      rows:[...document.querySelectorAll('.record-table tbody tr')].map(row => ({id:row.dataset.operation,
        improvement:row.querySelector('[data-comparison]').textContent, missing:!!row.querySelector('.coverage-info'),
        mouse:row.querySelector('[data-kind="mouse"]').textContent,key:row.querySelector('[data-kind="key"]').textContent,
        rate:row.querySelector('.record-rate').textContent}))};
  })()`);
  await ready();
  let view = await read();
  assert.equal(view.rate, "75.0%");
  assert.equal(view.improvement, "+50.0pt");
  assert.equal(view.info, 0);
  await choose("集計対象", "all");
  view = await read();
  assert.equal(view.key, "8回");
  assert.equal(view.mouse, "3回");
  assert.equal(view.improvement, "+50.5pt");
  assert.equal(view.keyDifference, "+6");
  assert.equal(view.mouseDifference, "-4");
  const row = (id: string) =>
    view.rows.find((r: { id: string }) => r.id === id)!;
  assert.equal(row("W03").improvement, "+50.0pt");
  assert.equal(row("W03").missing, false);
  assert.equal(row("W11").improvement, "+25.0pt");
  assert.equal(row("W11").missing, false); // legacy positive counts
  assert.equal(row("W02").improvement, "ー");
  assert.equal(row("W02").key, "2"); // prior known zero
  assert.equal(row("W04").improvement, "ー");
  assert.equal(row("W04").key, "0");
  assert.ok(row("W04").rate.includes("記録なし"));
  assert.equal(row("W06").improvement, "ー");
  assert.equal(row("W06").key, "0");
  assert.ok(row("W06").rate.includes("0.0%"));
  assert.equal(row("W07").improvement, "ー");
  assert.equal(row("W07").key, "ー");
  assert.equal(row("W12").improvement, "ー");
  assert.equal(row("W12").missing, false);
  assert.equal(view.info, 0); // Missing coverage remains in the model, without warning UI.
  assert.equal(
    await window.webContents.executeJavaScript(
      `document.querySelector('.record-table-heading [aria-label="キー率の計算方法"]')?.querySelector('img').classList.contains('imgHelpIconHover')`,
    ),
    true,
  );

  // Count differences for observed zero / unknown must also arrive intact over the real IPC.
  const model = await window.webContents.executeJavaScript(
    `window.coach.getRecordSummary({period:7,filter:'all',sort:'rate'})`,
  );
  assert.equal(
    model.rows.find((r: { id: string }) => r.id === "W02").comparison.key,
    2,
  );
  assert.equal(
    model.rows.find((r: { id: string }) => r.id === "W04").comparison.mouse,
    -2,
  );
  assert.equal(
    model.rows.find((r: { id: string }) => r.id === "W06").comparison.total,
    null,
  );
  assert.equal(
    model.rows.find((r: { id: string }) => r.id === "W07").comparison.total,
    null,
  );
  const sizes: unknown[] = [];
  assert.equal(
    await window.webContents.executeJavaScript(
      `document.querySelector('[aria-label="前期間比について"] .tooltip')?.textContent`,
    ),
    "直前の7日間との差です。",
  );
  await choose("集計対象", "learning");
  view = await read();
  assert.equal(view.info, 0);
  assert.equal(view.improvement, "+50.0pt");
  assert.equal(
    await window.webContents.executeJavaScript(
      `!!document.querySelector('.coverage-tooltip')`,
    ),
    false,
  );
  await choose("期間", "30");
  view = await read();
  assert.equal(view.keyDifference, "+4");
  assert.equal(view.mouseDifference, "+4");
  assert.equal(view.improvement, "ー");
  assert.equal(view.info, 0);
  await choose("期間", "7");
  await window.webContents.executeJavaScript(
    `window.coach.setLearningState('W03','excluded')`,
  );
  await ready();
  view = await read();
  assert.equal(view.rate, "ー");
  assert.equal(view.key, "ー");
  assert.equal(view.info, 0);
  assert.equal(view.rows.length, 0);
  await choose("集計対象", "learning-mastered");
  view = await read();
  assert.equal(view.rate, "記録なし");
  assert.equal(view.key, "0回");
  assert.equal(view.keyDifference, "0");
  assert.equal(view.improvement, "ー");
  assert.equal(view.info, 0);
  // Isolate each decision-table row as a KPI as well, so count differences are visibly asserted.
  const decisions = [];
  for (const [id, expected] of [
    [
      "W02",
      {
        rate: "100.0%",
        key: "2回",
        mouse: "0回",
        keyDifference: "+2",
        mouseDifference: "0",
        improvement: "ー",
      },
    ],
    [
      "W04",
      {
        rate: "記録なし",
        key: "0回",
        mouse: "0回",
        keyDifference: "0",
        mouseDifference: "-2",
        improvement: "ー",
      },
    ],
    [
      "W06",
      {
        rate: "0.0%",
        key: "0回",
        mouse: "1回",
        keyDifference: "ー",
        mouseDifference: "ー",
        improvement: "ー",
      },
    ],
    [
      "W07",
      {
        rate: "ー",
        key: "ー",
        mouse: "ー",
        keyDifference: "ー",
        mouseDifference: "ー",
        improvement: "ー",
      },
    ],
    [
      "W11",
      {
        rate: "75.0%",
        key: "3回",
        mouse: "1回",
        keyDifference: "+2",
        mouseDifference: "0",
        improvement: "+25.0pt",
      },
    ],
  ] as const) {
    await window.webContents.executeJavaScript(
      `window.coach.setLearningState('${id}','learning')`,
    );
    await choose("集計対象", "learning");
    view = await read();
    for (const [key, value] of Object.entries(expected))
      assert.equal(view[key], value, id + " " + key);
    assert.equal(view.info, 0); // No missing-coverage UI.
    decisions.push({ id, ...view });
    await window.webContents.executeJavaScript(
      `window.coach.setLearningState('${id}','excluded')`,
    );
    await ready();
  }
  await writeFile(
    join(app.getPath("userData"), "records-comparison-decisions.json"),
    JSON.stringify({ fixtureOnly: true, decisions }, null, 2),
  );
  await writeFile(
    join(app.getPath("userData"), "records-comparison-layout.json"),
    JSON.stringify({ fixtureOnly: true, sizes }, null, 2),
  );
  return {
    fixtureOnly: true,
    comparisonDecisionTable: true,
    sqliteWorker: true,
    realIpc: true,
    filters: true,
    naturalInputVerified: false,
  };
}
