import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoginStartup, loginItemName, loginItemArgs } from '../src/main/login-startup.ts';

test('reads a registered executable in a path containing spaces and preserves OS-disabled approval', () => {
  const path = 'C:\\Program Files\\Shortcut Expert\\Shortcut Expert.exe';
  let registered = false, approved = true, writes = 0;
  const startup = new LoginStartup({
    getLoginItemSettings(options) {
      // Electron parses the supplied path as a command line before matching the Run entry.
      const lookup = options.path.startsWith('"') ? options.path.slice(1, options.path.indexOf('"', 1)) : options.path.split(' ')[0];
      return { launchItems: registered && lookup === path ? [{ name: loginItemName, scope: 'user', enabled: approved, path, args: loginItemArgs }] : [] };
    },
    setLoginItemSettings(options) { assert.equal(options.path, path); registered = options.openAtLogin; writes++; }
  }, path);
  assert.equal(startup.set(true).enabled, true);
  assert.equal(startup.read().enabled, true);
  approved = false;
  assert.equal(startup.read().enabled, false);
  assert.ok(startup.set(true).error);
  assert.equal(writes, 1, 'must not overwrite Windows-disabled approval');
  assert.equal(startup.set(false).enabled, false);
});

test('login registration is opt-in, reads Windows approval and writes only on explicit commands', () => {
  let registered = false, enabled = true, writes = 0;
  const api = {
    getLoginItemSettings(options: unknown) {
      assert.deepEqual(options, { path: 'fixture.exe', args: loginItemArgs });
      return { openAtLogin: false, launchItems: registered ? [{ name: loginItemName, scope: 'user', enabled, path: 'fixture.exe', args: loginItemArgs }] : [] };
    },
    setLoginItemSettings(options: { openAtLogin: boolean; name: string; path: string; args: string[]; enabled?: boolean }) {
      assert.equal(options.name, loginItemName); assert.equal(options.path, 'fixture.exe');
      assert.deepEqual(options.args, loginItemArgs);
      assert.equal(options.enabled, options.openAtLogin);
      registered = options.openAtLogin; writes++;
    }
  };
  const startup = new LoginStartup(api, 'fixture.exe');
  assert.equal(startup.read().enabled, false); assert.equal(writes, 0);
  assert.equal(startup.set(true).enabled, true);
  enabled = false;
  assert.equal(startup.read().enabled, false); assert.equal(writes, 1);
  assert.ok(startup.set(true).error, 'OS-disabled registration must not be reported as enabled');
  assert.equal(writes, 1, 'do not rewrite a disabled StartupApproved item');
  assert.equal(startup.set(false).enabled, false);
});
test('unavailable API and registration/read failures are visible without false success', () => {
  assert.equal(new LoginStartup(null, 'fixture.exe').read().available, false);
  const denied = new LoginStartup({ getLoginItemSettings() { throw new Error('fixture'); }, setLoginItemSettings() { throw new Error('fixture'); } }, 'fixture.exe');
  assert.equal(denied.read().enabled, false); assert.ok(denied.read().error);
  assert.equal(denied.set(true).enabled, false); assert.ok(denied.set(true).error);
});
test('readback requires this user, executable and exact background arguments; silent rejection stays OFF', () => {
  const entry = { name: loginItemName, scope: 'user', enabled: true, path: 'FIXTURE.EXE', args: loginItemArgs };
  let items = [entry];
  const startup = new LoginStartup({ getLoginItemSettings: () => ({ launchItems: items }), setLoginItemSettings() {} }, 'fixture.exe');
  assert.equal(startup.read().enabled, true, 'Windows executable paths are case insensitive');
  for (const invalid of [{ ...entry, scope: 'machine' }, { ...entry, path: 'other.exe' }, { ...entry, args: [] },
    { ...entry, args: [...loginItemArgs, '--other'] }, { ...entry, name: 'other' }]) {
    items = [invalid]; assert.equal(startup.read().enabled, false);
  }
  items = [];
  const rejected = startup.set(true);
  assert.equal(rejected.enabled, false); assert.ok(rejected.error);
});
