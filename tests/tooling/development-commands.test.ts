import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { developmentEnvironment, checkWritableDirectories } from '../../scripts/dev/dev-environment.mjs';
import { smokeSucceeded, smokeFailureSummary } from '../../scripts/test/smoke-result.mjs';

test('builder cache runs downloaded CommonJS icon tools inside an ESM workspace', t => {
  mkdirSync('.tools/tests', { recursive: true });
  const root = mkdtempSync(resolve('.tools/tests/builder-module-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  const env = developmentEnvironment(root);
  const bundle = join(env.ELECTRON_BUILDER_CACHE, 'icons-fixture');
  mkdirSync(bundle);
  const script = join(bundle, 'icon-tool.js');
  writeFileSync(script, 'console.log(typeof require("node:fs").readFileSync);');
  const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'function');
});

test('development runner passes workspace TEMP and caches to child tools on every invocation', t => {
  mkdirSync('.tools/tests', {recursive:true});
  const root = mkdtempSync(resolve('.tools/tests/dev-tools-'));
  t.after(() => rmSync(root, { recursive:true, force:true }));
  mkdirSync(join(root,'node_modules/electron-vite/bin'), {recursive:true});
  mkdirSync(join(root,'node_modules/electron-builder'), {recursive:true});
  const probe = `console.log(JSON.stringify({temp:process.env.TEMP,tmp:process.env.TMP,electron:process.env.ELECTRON_CACHE,builder:process.env.ELECTRON_BUILDER_CACHE,args:process.argv.slice(2)}));`;
  writeFileSync(join(root,'node_modules/electron-vite/bin/electron-vite.js'), probe);
  writeFileSync(join(root,'node_modules/electron-builder/cli.js'), probe);
  const env = developmentEnvironment(root, { ...process.env, TEMP:'unwritable-old-temp', ELECTRON_CACHE:'old-cache' });
  checkWritableDirectories(env);
  for (const tool of ['electron-vite','electron-builder']) {
    const result = spawnSync(process.execPath, [resolve('scripts/dev/dev-run.mjs'),tool,'build','a & b'], {
      cwd:root, env:{...process.env,TEMP:'unwritable-old-temp'}, encoding:'utf8', windowsHide:true
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { temp:join(root,'.tools/test-temp'), tmp:join(root,'.tools/test-temp'),
      electron:join(root,'.tools/electron-cache'), builder:join(root,'.tools/builder-cache'),
      args:['build','a & b', ...(tool === 'electron-builder' ? [`--config.electronDownload.cache=${join(root,'.tools/electron-cache')}`] : [])] });
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

test('preflight accepts the SDK resolved by global.json rollForward and rejects host resolution failure', t => {
  mkdirSync('.tools/tests', {recursive:true});
  const root=mkdtempSync(resolve('.tools/tests/sdk-check-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,'global.json'),JSON.stringify({sdk:{version:'10.0.401',rollForward:'latestPatch'}}));
  writeFileSync(join(root,'package.json'),JSON.stringify({devDependencies:{electron:'44.7.0'}}));
  const child=join(root,'check.mjs');
  writeFileSync(child, `import { mock } from 'node:test';
    mock.module('node:child_process',{namedExports:{spawnSync:()=>({status:Number(process.env.FIXTURE_SDK_STATUS),stdout:'10.0.402\\n'})}});
    process.argv=['node','dev-run.mjs','check','--require=sdk'];
    await import(${JSON.stringify(pathToFileURL(resolve('scripts/dev/dev-run.mjs')).href)});`);
  const env={...process.env}; delete env.NODE_TEST_CONTEXT;
  for (const status of [0,1]) {
    const result=spawnSync(process.execPath,['--experimental-test-module-mocks',child],{cwd:root,encoding:'utf8',windowsHide:true,env:{...env,FIXTURE_SDK_STATUS:String(status)}});
    assert.equal(result.status,status,result.stdout+result.stderr);
  }
});

test('smoke sets local cache before Electron module can trigger its first download', t=>{
  mkdirSync('.tools/tests',{recursive:true});
  const root=mkdtempSync(resolve('.tools/tests/smoke-loader-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'scripts/test'),{recursive:true}); mkdirSync(join(root,'scripts/dev'),{recursive:true}); mkdirSync(join(root,'node_modules/electron'),{recursive:true});
  for(const [dir,name] of [['test','smoke.mjs'],['dev','dev-environment.mjs'],['test','smoke-result.mjs']]) copyFileSync(resolve('scripts',dir,name),join(root,'scripts',dir,name));
  writeFileSync(join(root,'package.json'),JSON.stringify({main:'fixture-app.cjs'}));
  writeFileSync(join(root,'node_modules/electron/index.js'),`
    const assert=require('node:assert/strict'),path=require('node:path');
    assert.equal(process.env.electron_config_cache,path.resolve('.tools/electron-cache'));
    assert.equal(process.env.TEMP,path.resolve('.tools/test-temp'));
    module.exports=process.execPath;
  `);
  writeFileSync(join(root,'fixture-app.cjs'),`console.log('COACH_SMOKE_OK {}');`);
  const env:NodeJS.ProcessEnv={...process.env,TEMP:'old-temp',electron_config_cache:'old-cache'}; delete env.NODE_TEST_CONTEXT;
  const result=spawnSync(process.execPath,[join(root,'scripts/test/smoke.mjs')],{cwd:root,env,encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/COACH_SMOKE_OK/);
});
