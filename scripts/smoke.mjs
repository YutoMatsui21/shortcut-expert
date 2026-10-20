import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { developmentEnvironment } from './dev-environment.mjs';
import { smokeSucceeded, smokeFailureSummary } from './smoke-result.mjs';

const packaged = process.argv.includes('--packaged');
const packageOption = process.argv.indexOf('--package-dir');
const packageDir = packageOption >= 0 ? process.argv[packageOption + 1] : 'release';
if (!packageDir) throw new Error('--package-dir needs a folder');
// Electron can install its binary during module loading, before the app is spawned.
const environment = developmentEnvironment();
Object.assign(process.env, environment);
const executable = packaged ? resolve(packageDir, 'win-unpacked/Window Shortcut Coach.exe') : (await import('electron')).default;
const migration = process.argv.includes('--migration');
const options = [migration ? '--migration-smoke' : process.argv.includes('--storage') ? '--storage-smoke' : '--coach-smoke'];
if (process.argv.includes('--real-display')) options.push('--real-display-smoke');
const args = packaged ? options : [resolve('.'), ...options];
mkdirSync(resolve('.tools/tests'), { recursive: true });
environment.COACH_TEST_DATA_DIR = mkdtempSync(join(resolve('.tools/tests'), 'coach-'));
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.ELECTRON_RENDERER_URL;
if (migration) {
  writeFileSync(join(environment.COACH_TEST_DATA_DIR, 'counts.json'), '  {"schemaVersion":1,"days":{"2020-01-02":{"W03":{"mouse":7,"key":5},"W09":{"mouse":100,"key":100}}}}\n');
  writeFileSync(join(environment.COACH_TEST_DATA_DIR, 'settings.json'), '{"schemaVersion":1,"muted":["W03","W09"],"opened":true}');
}
for (let boot = 0; boot < (migration ? 2 : 1); boot++) {
const result = spawnSync(executable, args, {
  encoding: 'utf8', windowsHide: true, timeout: 30_000,
  maxBuffer: 65_536, env: environment
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.error) console.error(result.error.message);
const success = smokeSucceeded(result);
if (!success && result.stderr) process.stderr.write(result.stderr);
if (!success) {
  console.error(smokeFailureSummary(result, options[0], boot + 1));
  process.exit(1);
}
}
process.exit(0);
