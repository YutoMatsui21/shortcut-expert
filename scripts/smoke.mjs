import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { mkdirSync, mkdtempSync } from 'node:fs';
import electron from 'electron';

const packaged = process.argv.includes('--packaged');
const packageOption = process.argv.indexOf('--package-dir');
const packageDir = packageOption >= 0 ? process.argv[packageOption + 1] : 'release';
if (!packageDir) throw new Error('--package-dir needs a folder');
const executable = packaged ? resolve(packageDir, 'win-unpacked/Window Shortcut Coach.exe') : electron;
const options = [process.argv.includes('--storage') ? '--storage-smoke' : '--coach-smoke'];
if (process.argv.includes('--real-display')) options.push('--real-display-smoke');
const args = packaged ? options : [resolve('.'), ...options];
const environment = { ...process.env };
mkdirSync(resolve('.tools/tests'), { recursive: true });
environment.COACH_TEST_DATA_DIR = mkdtempSync(join(resolve('.tools/tests'), 'coach-'));
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.ELECTRON_RENDERER_URL;
const result = spawnSync(executable, args, {
  encoding: 'utf8', windowsHide: true, timeout: 30_000,
  maxBuffer: 65_536, env: environment
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.error) console.error(result.error.message);
const success = result.status === 0 && result.stdout?.includes('COACH_SMOKE_OK ');
if (!success && result.stderr) process.stderr.write(result.stderr);
process.exit(success ? 0 : 1);
