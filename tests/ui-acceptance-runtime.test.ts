import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { packageManifest, waitForUiAcceptance } from '../scripts/acceptance/ui-acceptance-runtime.mjs';

class FixtureChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill() { this.killed = true; this.emit('close',null); return true; }
  unref() {}
}

test('UI acceptance waits for piped output after exit before classifying success', async () => {
  const child = new FixtureChild();
  const result = waitForUiAcceptance(child, () => {});
  child.emit('exit',0);
  child.stdout.emit('data','V03_READY fixture-only');
  child.emit('close',0);
  assert.equal(await result,0);
});

test('matrix deadline stops a stalled child and reports failure', async () => {
  const child = new FixtureChild();
  const result = waitForUiAcceptance(child, () => {},10);
  await new Promise(resolve => setTimeout(resolve,30));
  assert.equal(child.killed,true);
  assert.equal(await result,1);
});

test('package identity changes when an Electron runtime resource changes', () => {
  const root = mkdtempSync(join(tmpdir(),'ui-manifest-'));
  mkdirSync(join(root,'resources/native-helper'),{recursive:true});
  for (const path of ['Shortcut Expert.exe','resources/app.asar','resources/native-helper/WindowObserver.exe','resources/runtime.pak']) {
    writeFileSync(join(root,path),'fixture');
  }
  const before = packageManifest(root);
  writeFileSync(join(root,'resources/runtime.pak'),'changed fixture');
  const after = packageManifest(root);
  assert.notDeepEqual(after,before);
  assert.equal(after.length,4);
});
