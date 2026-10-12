import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';

let failing = '';
mock.module('node:fs/promises', { namedExports: {
  mkdir: fs.mkdir, readFile: fs.readFile,
  rename: async (...args: Parameters<typeof fs.rename>) => { if (failing === 'rename') throw new Error('fixture-rename'); return fs.rename(...args); },
  open: async (...args: Parameters<typeof fs.open>) => {
    if (failing === 'open') throw new Error('fixture-open');
    const handle = await fs.open(...args);
    return {
      writeFile: async (...values: Parameters<typeof handle.writeFile>) => {
        if (failing === 'write') { await handle.writeFile('{partial-fixture'); throw new Error('fixture-write'); }
        return handle.writeFile(...values);
      },
      sync: async () => { if (failing === 'sync') throw new Error('fixture-sync'); return handle.sync(); },
      close: async () => { await handle.close(); if (failing === 'close') throw new Error('fixture-close'); }
    };
  }
} });
const { JsonRepository } = await import('../src/main/repository.ts');

for (const stage of ['open', 'write', 'sync', 'close', 'rename']) {
  test(`${stage}失敗と再起動でも確定済み原本を保持し再試行で復旧する`, async (t) => {
    const root = resolve('.tools/tests'); await fs.mkdir(root, { recursive: true });
    const directory = await fs.mkdtemp(join(root, 'fault-'));
    t.after(async () => {
      failing = '';
      const path = relative(root, directory);
      assert.ok(path && !path.startsWith('..') && !isAbsolute(path));
      await fs.rm(directory, { recursive: true, force: true });
    });
    const repository = new JsonRepository(directory);
    const original = { '2026-10-11': { W03: { mouse: 1, key: 2 } } };
    await repository.saveCounts(original);
    await repository.saveSettings({ muted: ['W03'], opened: true });
    const bytes = await fs.readFile(join(directory, 'counts.json'), 'utf8');
    failing = stage;
    await assert.rejects(repository.saveCounts({}), new RegExp(`fixture-${stage}`));
    assert.equal(await fs.readFile(join(directory, 'counts.json'), 'utf8'), bytes);
    assert.deepEqual((await new JsonRepository(directory).load()).counts, original);
    failing = ''; await repository.saveCounts({});
    assert.deepEqual(await new JsonRepository(directory).load(), { counts: {}, settings: { muted: ['W03'], opened: true } });
    assert.deepEqual((await fs.readdir(directory)).sort(), ['counts.json', 'settings.json']);
  });
}
