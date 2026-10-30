import { test } from 'node:test';
import assert from 'node:assert/strict';
import { naturalInputOperation } from '../src/main/natural-input-mode.ts';
test('bootstrap isolation and ARM controller share exactly the documented opt-in flags', () => {
  assert.equal(naturalInputOperation(['--w08-natural-acceptance']), 'W08');
  assert.equal(naturalInputOperation(['--w12-natural-acceptance']), 'W12');
  assert.equal(naturalInputOperation(['--w01-natural-acceptance']), 'W01');
  for (const argv of [[], ['--natural-input-acceptance'], ['--observe-consented'], ['--coach-smoke']])
    assert.equal(naturalInputOperation(argv), null);
});
