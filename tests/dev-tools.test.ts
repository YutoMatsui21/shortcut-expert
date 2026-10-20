import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { developmentEnvironment, checkWritableDirectories } from '../scripts/dev-environment.mjs';
import { smokeSucceeded, smokeFailureSummary } from '../scripts/smoke-result.mjs';

test('development runner passes workspace TEMP and caches to child tools on every invocation', t => {
  mkdirSync('.tools/tests', {recursive:true});
  const root = mkdtempSync(resolve('.tools/tests/dev-tools-'));
  t.after(() => rmSync(root, { recursive:true, force:true }));
  mkdirSync(join(root,'node_modules/electron-vite/bin'), {recursive:true});
  writeFileSync(join(root,'node_modules/electron-vite/bin/electron-vite.js'), `console.log(JSON.stringify({temp:process.env.TEMP,tmp:process.env.TMP,electron:process.env.ELECTRON_CACHE,builder:process.env.ELECTRON_BUILDER_CACHE,args:process.argv.slice(2)}));`);
  const env = developmentEnvironment(root, { ...process.env, TEMP:'unwritable-old-temp', ELECTRON_CACHE:'old-cache' });
  checkWritableDirectories(env);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = spawnSync(process.execPath, [resolve('scripts/dev-run.mjs'),'electron-vite','build','a & b'], {
      cwd:root, env:{...process.env,TEMP:'unwritable-old-temp'}, encoding:'utf8', windowsHide:true
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { temp:join(root,'.tools/test-temp'), tmp:join(root,'.tools/test-temp'),
      electron:join(root,'.tools/electron-cache'), builder:join(root,'.tools/builder-cache'), args:['build','a & b'] });
  }
});

test('smoke diagnostics distinguish empty failure, timeout and missing success marker', () => {
  assert.equal(smokeSucceeded({status:0,stdout:'negative IPC tests passed'}), false);
  assert.equal(smokeSucceeded({status:1,stdout:'COACH_SMOKE_OK {}'}), false);
  assert.equal(smokeSucceeded({status:0,stdout:'COACH_SMOKE_OK {}'}), true);
  const empty = JSON.parse(smokeFailureSummary({status:1,stdout:'',stderr:''}, '--storage-smoke',1));
  assert.equal(empty.event,'COACH_SMOKE_PROCESS_FAILED');
  assert.equal(empty.status,1); assert.equal(empty.stdoutBytes,0); assert.equal(empty.mode,'--storage-smoke');
  const timeout = JSON.parse(smokeFailureSummary({status:null,signal:'SIGTERM',error:new Error('spawn ETIMEDOUT')},'--migration-smoke',2));
  assert.equal(timeout.error,'spawn ETIMEDOUT'); assert.equal(timeout.boot,2); assert.equal(timeout.signal,'SIGTERM');
});
