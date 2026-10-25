import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { developmentEnvironment } from './dev-environment.mjs';

const suite = process.argv[2];
if (!['unit', 'native'].includes(suite)) throw new Error('Expected unit or native suite');
const options = process.argv.slice(3);
const selected = [];
const forwarded = [];
for (const option of options) {
  if (option === '--coverage') continue;
  if (option.startsWith('--file=')) {
    const file = option.slice('--file='.length);
    if (!/^[\w.-]+\.test\.ts$/.test(file)) throw new Error('Expected a test filename inside tests/');
    selected.push(file);
  } else if (option.startsWith('--test-name-pattern=')) {
    const pattern = option.slice('--test-name-pattern='.length);
    if (!pattern) throw new Error('Expected a non-empty test name pattern');
    new RegExp(pattern);
    forwarded.push(option);
  } else if (/^--test-reporter=(spec|tap|dot)$/.test(option)) {
    forwarded.push(option);
  } else if (/^--test-concurrency=(1|2|4|8)$/.test(option)) {
    forwarded.push(option);
  } else throw new Error(`Unknown test option: ${option}`);
}
// Native suites have a native prefix; every other root *.test.ts joins the fast suite.
const available = readdirSync('tests').filter((name) => name.endsWith('.test.ts') && name.startsWith('native') === (suite === 'native'));
for (const file of selected) {
  if (!available.includes(file)) throw new Error(`Test is not in the ${suite} suite: ${file}`);
}
const files = (selected.length ? [...new Set(selected)] : available).sort().map((name) => `tests/${name}`);
if (!files.length) throw new Error(`No ${suite} tests discovered`);
const args = ['--experimental-test-module-mocks', '--test', '--test-timeout=' + (suite === 'native' ? '60000' : '10000')];
if (process.argv.includes('--coverage')) args.push('--experimental-test-coverage', '--test-coverage-include=src/**/*.ts');
const result = spawnSync(process.execPath, [...args, ...forwarded, ...files], { stdio: 'inherit', windowsHide: true, env: developmentEnvironment() });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
