import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
