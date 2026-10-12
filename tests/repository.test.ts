import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { JsonRepository } from '../src/main/repository.ts';

async function directory() {
  const root = resolve('.tools/tests'); await mkdir(root, { recursive: true });
  return mkdtemp(join(root, 'repository-'));
}

test('再起動後も日別数値とmuteを読み戻し、保存形式は集計と設定だけ', async () => {
  const path = await directory(); const first = new JsonRepository(path);
  await first.saveCounts({ '2026-10-11': { W03: { mouse: 3, key: 2 } } });
  await first.saveSettings({ muted: ['W03'], opened: true });
  assert.deepEqual(await new JsonRepository(path).load(), {
    counts: { '2026-10-11': { W03: { mouse: 3, key: 2 } } }, settings: { muted: ['W03'], opened: true }
  });
  assert.deepEqual(JSON.parse(await readFile(join(path, 'counts.json'), 'utf8')), {
    schemaVersion: 1, days: { '2026-10-11': { W03: { mouse: 3, key: 2 } } }
  });
});

test('保存形式の破損・余計な生データを空記録にせず拒否する', async () => {
  const path = await directory();
  await writeFile(join(path, 'counts.json'), JSON.stringify({ schemaVersion: 1,
    days: { '2026-10-11': { W03: { mouse: -1, key: 0, title: 'do-not-store' } } } }));
  await assert.rejects(() => new JsonRepository(path).load(), /保存データ/);
  assert.match(await readFile(join(path, 'counts.json'), 'utf8'), /do-not-store/);
});

test('未作成ファイルと空の記録・操作日は受理し、設定を読み戻す', async () => {
  const path = await directory(); const repository = new JsonRepository(path);
  assert.deepEqual(await repository.load(), { counts: {}, settings: { muted: [], opened: false } });
  await repository.saveCounts({ '2026-10-11': {} });
  await repository.saveSettings({ muted: [], opened: false });
  assert.deepEqual(await repository.load(), { counts: { '2026-10-11': {} }, settings: { muted: [], opened: false } });
});

test('段階別に不正な保存文書を拒否し、両方の原本を保持する', async (t) => {
  const validCounts = { schemaVersion: 1, days: { '2026-10-11': { W03: { mouse: 1, key: 0 } } } };
  const validSettings = { schemaVersion: 1, muted: ['W03'], opened: true };
  const countDocuments: [string, unknown][] = [
    ['文書がnull', null], ['文書が配列', []], ['版欠落', { days: {} }],
    ['版違い', { ...validCounts, schemaVersion: 2 }], ['days欠落', { schemaVersion: 1 }],
    ['文書の余分な属性', { ...validCounts, extra: true }],
    ['日付形式違い', { schemaVersion: 1, days: { '2026-1-11': {} } }],
    ['存在しない日付', { schemaVersion: 1, days: { '2026-02-30': {} } }],
    ['日が配列', { schemaVersion: 1, days: { '2026-10-11': [] } }],
    ['未定義操作', { schemaVersion: 1, days: { '2026-10-11': { W99: { mouse: 1, key: 0 } } } }]
  ];
  for (const [name, counter] of [
    ['mouse欠落', { key: 0 }], ['key欠落', { mouse: 1 }], ['負数', { mouse: -1, key: 0 }],
    ['小数', { mouse: 0.5, key: 0 }], ['非安全整数', { mouse: Number.MAX_SAFE_INTEGER + 1, key: 0 }],
    ['文字列', { mouse: '1', key: 0 }], ['余分な属性', { mouse: 1, key: 0, extra: true }], ['null', null]
  ] as const) countDocuments.push([`カウンター${name}`, { schemaVersion: 1, days: { '2026-10-11': { W03: counter } } }]);
  const settingDocuments: [string, unknown][] = [
    ['版欠落', { muted: [], opened: false }], ['版違い', { ...validSettings, schemaVersion: 2 }],
    ['muted欠落', { schemaVersion: 1, opened: false }], ['opened欠落', { schemaVersion: 1, muted: [] }],
    ['openedの型違い', { ...validSettings, opened: 1 }], ['mutedの型違い', { ...validSettings, muted: 'W03' }],
    ['未定義mute', { ...validSettings, muted: ['W99'] }], ['mute重複', { ...validSettings, muted: ['W03', 'W03'] }],
    ['余分な属性', { ...validSettings, extra: true }]
  ];
  for (const [file, cases] of [['counts', countDocuments], ['settings', settingDocuments]] as const) {
    for (const [name, document] of cases) await t.test(`${file}: ${name}`, async () => {
      const path = await directory();
      const counts = JSON.stringify(file === 'counts' ? document : validCounts);
      const settings = JSON.stringify(file === 'settings' ? document : validSettings);
      await writeFile(join(path, 'counts.json'), counts);
      await writeFile(join(path, 'settings.json'), settings);
      await assert.rejects(() => new JsonRepository(path).load(), {
        message: '保存データの形式が不正です。元のファイルは保持しています。'
      });
      assert.equal(await readFile(join(path, 'counts.json'), 'utf8'), counts);
      assert.equal(await readFile(join(path, 'settings.json'), 'utf8'), settings);
    });
  }
});

test('読込みエラーを形式エラーより先に返し、原本を保持する', async () => {
  const path = await directory();
  await writeFile(join(path, 'counts.json'), '{"schemaVersion":2}');
  await writeFile(join(path, 'settings.json'), '{broken');
  await assert.rejects(() => new JsonRepository(path).load(), {
    message: '保存データを読み込めません。元のファイルは保持しています。'
  });
  assert.equal(await readFile(join(path, 'counts.json'), 'utf8'), '{"schemaVersion":2}');
  assert.equal(await readFile(join(path, 'settings.json'), 'utf8'), '{broken');
});

test('同時保存は順番を守り、一時ファイルの失敗後も他の保存と再試行を続ける', async () => {
  const path = await directory(); const repository = new JsonRepository(path);
  await Promise.all([1, 2, 3].map((mouse) => repository.saveCounts({ '2026-10-11': { W03: { mouse, key: 0 } } })));
  await mkdir(join(path, 'counts.json.tmp'));
  const failed = repository.saveCounts({});
  const next = repository.saveSettings({ muted: ['W03'], opened: true });
  await assert.rejects(failed);
  await next;
  assert.deepEqual(await repository.load(), {
    counts: { '2026-10-11': { W03: { mouse: 3, key: 0 } } }, settings: { muted: ['W03'], opened: true }
  });
  await rename(join(path, 'counts.json.tmp'), join(path, 'blocked-tmp'));
  await repository.saveCounts({});
  assert.deepEqual((await repository.load()).counts, {});
});
