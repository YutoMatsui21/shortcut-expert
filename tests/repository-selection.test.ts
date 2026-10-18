import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as filesystem from 'node:fs/promises';
let denied = true;
mock.module('node:fs/promises', { namedExports: { ...filesystem, access: async () => {
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
