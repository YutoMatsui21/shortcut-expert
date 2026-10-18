import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as filesystem from 'node:fs/promises';
import type { PathLike } from 'node:fs';
let denied = true;
let authority = false;
mock.module('node:fs/promises', { namedExports: { ...filesystem, access: async (file: PathLike) => {
  if (authority && String(file).endsWith('records-v1')) return;
  throw Object.assign(new Error('fixture'), { code: denied ? 'EACCES' : 'ENOENT' });
} } });
const { selectRepositoryWithRetry, SqliteRepository } = await import('../src/main/sqlite-repository.ts');
test('selection I/O failure displays recovery before retry and never selects a fallback', async () => {
  let prompts = 0;
  const repository = await selectRepositoryWithRetry('unused-fixture-root', 'unused-worker', async () => { prompts++; denied = false; return true; });
  assert.equal(prompts, 1); assert.ok(repository instanceof SqliteRepository); await repository.close();
  denied = true;
  await assert.rejects(selectRepositoryWithRetry('unused-fixture-root', 'unused-worker', async () => false), /STORAGE_SELECTION_CANCELLED/);
});
test('SQLite authority is selected without touching unreadable obsolete JSON', async () => {
  denied = true; authority = true; let prompts = 0;
  try {
    const repository = await selectRepositoryWithRetry('unused-fixture-root', 'unused-worker', async () => { prompts++; return false; });
    assert.ok(repository instanceof SqliteRepository); assert.equal(prompts, 0); await repository.close();
  } finally { authority = false; }
});
