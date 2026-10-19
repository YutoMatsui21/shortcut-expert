import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const runner = resolve('scripts/test.mjs');

test('test CLI selects a file and name while retaining module mock support', () => {
  const parent = resolve('.tools/tests');
  mkdirSync(parent, { recursive: true });
  const cwd = mkdtempSync(join(parent, 'runner-'));
  try {
    mkdirSync(join(cwd, 'tests'));
    writeFileSync(join(cwd, 'tests/selected.test.ts'), `
      import { test, mock } from 'node:test';
      import assert from 'node:assert/strict';
      mock.module('node:os', { namedExports: { hostname: () => 'fixture' } });
      const { hostname } = await import('node:os');
      test('selected case', () => assert.equal(hostname(), 'fixture'));
      test('excluded case', () => assert.fail('name filter ignored'));
    `);
    writeFileSync(join(cwd, 'tests/other.test.ts'), "throw new Error('file filter ignored');");
    writeFileSync(join(cwd, 'tests/native-fixture.test.ts'), "import { test } from 'node:test'; test('native fixture', () => {});");
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = (...args: string[]) => spawnSync(process.execPath, [runner, 'unit', ...args], {
      cwd, env, encoding: 'utf8', windowsHide: true, timeout: 20_000
    });
    const selected = run('--file=selected.test.ts', '--test-name-pattern=^selected case$', '--test-reporter=tap');
    assert.equal(selected.status, 0, selected.stdout + selected.stderr);
    assert.match(selected.stdout, /ok 1 - selected case/);
    const failure = run('--file=selected.test.ts', '--test-name-pattern=^excluded case$');
    assert.equal(failure.status, 1, failure.stdout + failure.stderr);
    const all = run();
    assert.equal(all.status, 1, all.stdout + all.stderr);
    assert.match(all.stdout + all.stderr, /file filter ignored/);
    const native = spawnSync(process.execPath, [runner, 'native', '--file=native-fixture.test.ts'], {
      cwd, env, encoding: 'utf8', windowsHide: true, timeout: 20_000
    });
    assert.equal(native.status, 0, native.stdout + native.stderr);
    assert.match(native.stdout, /native fixture/);
    for (const args of [['--file=missing.test.ts'], ['--file=../selected.test.ts'], ['--file=native-fixture.test.ts'], ['--typo'], ['--file=selected.test.ts', '--test-name-pattern=[']]) {
      const invalid = run(...args);
      assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr);
      assert.doesNotMatch(invalid.stdout, /selected case|file filter ignored/);
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
