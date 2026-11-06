import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { test, type TestContext } from "node:test";
import { readLegacy } from "../../src/main/storage-migration.ts";

async function directory(t: TestContext) {
  const root = resolve(".tools/tests");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "repository-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("旧形式readerは日別集計と設定を読み、原本を書き換えない", async (t) => {
  const path = await directory(t);
  const counts = {
    schemaVersion: 1,
    days: { "2026-10-11": { W03: { mouse: 3, key: 2 } } },
  };
  const settings = { schemaVersion: 1, muted: ["W03"], opened: true };
  await writeFile(join(path, "counts.json"), JSON.stringify(counts));
  await writeFile(join(path, "settings.json"), JSON.stringify(settings));
  const imported = readLegacy(path);
  assert.deepEqual(imported.counts, counts.days);
  assert.deepEqual(imported.settings, { muted: ["W03"], opened: true });
  assert.equal(readLegacy(path).identity, imported.identity);
  assert.equal(
    await readFile(join(path, "counts.json"), "utf8"),
    JSON.stringify(counts),
  );
  assert.equal(
    await readFile(join(path, "settings.json"), "utf8"),
    JSON.stringify(settings),
  );
});

test("保存形式の破損・余計な生データを空記録にせず拒否する", async (t) => {
  const path = await directory(t);
  await writeFile(
    join(path, "counts.json"),
    JSON.stringify({
      schemaVersion: 1,
      days: {
        "2026-10-11": { W03: { mouse: -1, key: 0, title: "do-not-store" } },
      },
    }),
  );
  assert.throws(() => readLegacy(path), /INVALID_LEGACY/);
  assert.match(
    await readFile(join(path, "counts.json"), "utf8"),
    /do-not-store/,
  );
});

test("未作成ファイルと空の記録・操作日は受理し、設定を読み戻す", async (t) => {
  const path = await directory(t);
  const { counts, settings } = readLegacy(path);
  assert.deepEqual(
    { counts, settings },
    { counts: {}, settings: { muted: [], opened: false } },
  );
  await writeFile(
    join(path, "counts.json"),
    JSON.stringify({ schemaVersion: 1, days: { "2026-10-11": {} } }),
  );
  await writeFile(
    join(path, "settings.json"),
    JSON.stringify({ schemaVersion: 1, muted: [], opened: false }),
  );
  assert.deepEqual(readLegacy(path).counts, { "2026-10-11": {} });
});

test("段階別に不正な保存文書を拒否し、両方の原本を保持する", async (t) => {
  const validCounts = {
    schemaVersion: 1,
    days: { "2026-10-11": { W03: { mouse: 1, key: 0 } } },
  };
  const validSettings = { schemaVersion: 1, muted: ["W03"], opened: true };
  const countDocuments: [string, unknown][] = [
    ["文書がnull", null],
    ["文書が配列", []],
    ["版欠落", { days: {} }],
    ["版違い", { ...validCounts, schemaVersion: 2 }],
    ["days欠落", { schemaVersion: 1 }],
    ["文書の余分な属性", { ...validCounts, extra: true }],
    ["日付形式違い", { schemaVersion: 1, days: { "2026-1-11": {} } }],
    ["存在しない日付", { schemaVersion: 1, days: { "2026-02-30": {} } }],
    ["日が配列", { schemaVersion: 1, days: { "2026-10-11": [] } }],
    [
      "未定義操作",
      {
        schemaVersion: 1,
        days: { "2026-10-11": { W99: { mouse: 1, key: 0 } } },
      },
    ],
  ];
  for (const [name, counter] of [
    ["mouse欠落", { key: 0 }],
    ["key欠落", { mouse: 1 }],
    ["負数", { mouse: -1, key: 0 }],
    ["小数", { mouse: 0.5, key: 0 }],
    ["非安全整数", { mouse: Number.MAX_SAFE_INTEGER + 1, key: 0 }],
    ["文字列", { mouse: "1", key: 0 }],
    ["余分な属性", { mouse: 1, key: 0, extra: true }],
    ["null", null],
  ] as const)
    countDocuments.push([
      `カウンター${name}`,
      { schemaVersion: 1, days: { "2026-10-11": { W03: counter } } },
    ]);
  const settingDocuments: [string, unknown][] = [
    ["版欠落", { muted: [], opened: false }],
    ["版違い", { ...validSettings, schemaVersion: 2 }],
    ["muted欠落", { schemaVersion: 1, opened: false }],
    ["opened欠落", { schemaVersion: 1, muted: [] }],
    ["openedの型違い", { ...validSettings, opened: 1 }],
    ["mutedの型違い", { ...validSettings, muted: "W03" }],
    ["未定義mute", { ...validSettings, muted: ["W99"] }],
    ["mute重複", { ...validSettings, muted: ["W03", "W03"] }],
    ["余分な属性", { ...validSettings, extra: true }],
  ];
  for (const [file, cases] of [
    ["counts", countDocuments],
    ["settings", settingDocuments],
  ] as const) {
    for (const [name, document] of cases)
      await t.test(`${file}: ${name}`, async (t) => {
        const path = await directory(t);
        const counts = JSON.stringify(
          file === "counts" ? document : validCounts,
        );
        const settings = JSON.stringify(
          file === "settings" ? document : validSettings,
        );
        await writeFile(join(path, "counts.json"), counts);
        await writeFile(join(path, "settings.json"), settings);
        assert.throws(() => readLegacy(path), /INVALID_LEGACY/);
        assert.equal(await readFile(join(path, "counts.json"), "utf8"), counts);
        assert.equal(
          await readFile(join(path, "settings.json"), "utf8"),
          settings,
        );
      });
  }
});

test("不正JSONを空記録へ変換せず、両方の原本を保持する", async (t) => {
  const path = await directory(t);
  await writeFile(join(path, "counts.json"), '{"schemaVersion":2}');
  await writeFile(join(path, "settings.json"), "{broken");
  assert.throws(() => readLegacy(path), SyntaxError);
  assert.equal(
    await readFile(join(path, "counts.json"), "utf8"),
    '{"schemaVersion":2}',
  );
  assert.equal(await readFile(join(path, "settings.json"), "utf8"), "{broken");
});
