import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let deniedPath = '', interruptMarker = false;
mock.module('node:fs', { namedExports: { ...fs,
  existsSync: (file: fs.PathLike) => String(file) === deniedPath ? false : fs.existsSync(file),
  lstatSync: (file: fs.PathLike) => {
    if (String(file) === deniedPath) throw Object.assign(new Error('fixture access'), { code: 'EACCES' });
    return fs.lstatSync(file);
  },
  renameSync: (from: fs.PathLike, to: fs.PathLike) => {
    if (interruptMarker && String(to).endsWith('source.json')) throw new Error('fixture marker interruption');
    fs.renameSync(from, to);
  }
} });
const { prepareStorage } = await import('../../src/main/storage-migration.ts');

test('unreadable legacy presence stops instead of selecting a new empty authority', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'coach-access-'));
  t.after(() => { deniedPath = ''; fs.rmSync(root, { recursive: true, force: true }); });
  const counts = join(root, 'counts.json'); fs.writeFileSync(counts, '{"schemaVersion":1,"days":{}}');
  deniedPath = counts;
  assert.throws(() => prepareStorage(join(root, 'records-v1')), /fixture access/);
  assert.equal(fs.existsSync(join(root, 'records-v1')), false);
  deniedPath = ''; prepareStorage(join(root, 'records-v1'));
  assert.equal(fs.existsSync(join(root, 'records-v1', 'records.sqlite')), true);
});
test('interrupted ownership preparation never publishes an unowned stage and retry succeeds', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'coach-owner-'));
  t.after(() => { interruptMarker = false; fs.rmSync(root, { recursive: true, force: true }); });
  fs.writeFileSync(join(root, 'counts.json'), '{"schemaVersion":1,"days":{}}');
  interruptMarker = true;
  assert.throws(() => prepareStorage(join(root, 'records-v1')), /marker interruption/);
  assert.equal(fs.existsSync(join(root, 'migration-v1')), false);
  interruptMarker = false; prepareStorage(join(root, 'records-v1'));
  assert.equal(fs.existsSync(join(root, 'records-v1', 'records.sqlite')), true);
});
