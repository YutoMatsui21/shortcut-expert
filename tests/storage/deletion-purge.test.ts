import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
let denied = '';
mock.module('node:fs', { namedExports: { ...fs,
  unlinkSync: (path: fs.PathLike) => { if (String(path) === denied) throw new Error('fixture purge denied'); fs.unlinkSync(path); }
} });
const { StorageStore } = await import('../src/main/storage-store.ts');

test('reset removes known legacy temporary/staging copies even on a fresh authority; failure retries after restart', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'coach-delete-')), target = join(root, 'records-v1');
  fs.mkdirSync(target);
  t.after(() => { denied = ''; fs.rmSync(root, {recursive:true,force:true}); });
  let store = new StorageStore(target);
  const settings = {muted:[],opened:true,states:{W03:'mastered' as const},normalBounds:{x:-1000,y:20,width:800,height:600}};
  store.saveSettings(settings); store.claim('delete');
  const old = {epoch:1,writeSession:'delete',sequence:1,today:'2026-10-20',coverage:[],count:{day:'2026-10-20',operation:'W03' as const,origin:'key' as const}};
  store.commit(old);
  fs.writeFileSync(join(root, 'counts.json.tmp'), 'old record copy');
  fs.mkdirSync(join(root, 'migration-v1')); fs.writeFileSync(join(root, 'migration-v1', 'records.sqlite'), 'old stage');
  const reset = {epoch:1,writeSession:'delete',sequence:2,today:'2026-10-20',coverage:[],reset:true as const};
  denied = join(root, 'counts.json.tmp');
  assert.throws(() => store.commit(reset), /purge denied/);
  assert.deepEqual(store.query('2026-10-20','2026-10-20').counts, {});
  assert.equal(store.load('2026-10-20').epoch, 2);
  store.close(); denied = '';
  store = new StorageStore(target);
  try {
    store.commit(reset); // ACK loss and cleanup retry never advance epoch twice.
    assert.equal(store.load('2026-10-20').epoch, 2);
    assert.deepEqual(store.load('2026-10-20').settings, settings);
    assert.deepEqual(store.query('2026-10-20','2026-10-20').coverage, {});
    assert.throws(() => store.commit(old), /STALE_EPOCH/);
    assert.equal(fs.existsSync(join(root,'counts.json.tmp')), false);
    assert.equal(fs.existsSync(join(root,'migration-v1')), false);
  } finally { store.close(); }
});
