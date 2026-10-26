import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { startupMode } from '../src/main/startup-mode.ts';

test('bootstrap preserves normal storage and requires isolated packaged natural acceptance', async () => {
  const previous = process.env.COACH_TEST_DATA_DIR;
  const created: string[] = [], selected: string[] = [], exits: number[] = [];
  let contents: string[] = [];
  let temporary = 0;
  const app = {
    isPackaged: true, getPath: (name: string) => name === 'userData' ? 'normal-data' : 'temp',
    getAppPath: () => 'application', getName: () => 'fixture-app',
    setPath: (_name: string, data: string) => selected.push(data),
    exit: (code: number) => exits.push(code)
  };
  mock.module('electron', { namedExports: { app } });
  mock.module('node:fs', { namedExports: {
    mkdirSync: (path: string) => created.push(path),
    mkdtempSync: () => `isolated-${++temporary}`, readdirSync: () => contents
  } });
  const { configureStartupData } = await import('../src/main/startup-data.ts');
  try {
    process.env.COACH_TEST_DATA_DIR = 'test-override';
    configureStartupData(startupMode([]));
    assert.equal(selected.at(-1), 'normal-data', 'normal launch ignores the fixture override');
    assert.equal(temporary, 0);
    app.isPackaged = false;
    configureStartupData(startupMode([]));
    assert.equal(selected.at(-1), join('application', '.tools', 'coach-data'));
    configureStartupData(startupMode(['--coach-smoke']));
    assert.equal(selected.at(-1), 'test-override');
    delete process.env.COACH_TEST_DATA_DIR;
    configureStartupData(startupMode(['--storage-smoke']));
    configureStartupData(startupMode(['--storage-smoke']));
    assert.deepEqual(selected.slice(-2), ['isolated-1', 'isolated-2']);
    for (const flag of ['--w01-natural-acceptance', '--w08-natural-acceptance', '--w12-natural-acceptance']) {
      const mode = startupMode([flag]);
      assert.throws(() => configureStartupData(mode), /requires packaged app/);
      app.isPackaged = true;
      assert.throws(() => configureStartupData(mode), /new empty isolated directory/);
      process.env.COACH_TEST_DATA_DIR = 'empty-natural';
      contents = ['existing-data'];
      assert.throws(() => configureStartupData(mode), /new empty isolated directory/);
      contents = [];
      assert.throws(() => configureStartupData(startupMode([flag, '--coach-smoke'])), /new empty isolated directory/);
      configureStartupData(mode);
      assert.equal(selected.at(-1), 'empty-natural');
      app.isPackaged = false;
      assert.throws(() => configureStartupData(mode), /requires packaged app/);
      delete process.env.COACH_TEST_DATA_DIR;
    }
    configureStartupData(startupMode(['--os-notification-acceptance']));
    assert.deepEqual(exits, [1], 'OS acceptance still rejects a non-installed build');
    assert.ok(created.includes('empty-natural'));
  } finally {
    if (previous === undefined) delete process.env.COACH_TEST_DATA_DIR;
    else process.env.COACH_TEST_DATA_DIR = previous;
    mock.restoreAll();
  }
});
