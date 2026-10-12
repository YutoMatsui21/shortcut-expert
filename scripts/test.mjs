import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const suite = process.argv[2];
if (!['unit', 'native'].includes(suite)) throw new Error('Expected unit or native suite');
// Native suites have a native prefix; every other root *.test.ts joins the fast suite.
const files = readdirSync('tests').filter((name) => name.endsWith('.test.ts') && name.startsWith('native') === (suite === 'native'))
  .sort().map((name) => `tests/${name}`);
if (!files.length) throw new Error(`No ${suite} tests discovered`);
const args = ['--experimental-test-module-mocks', '--test', '--test-timeout=' + (suite === 'native' ? '60000' : '10000')];
if (process.argv.includes('--coverage')) args.push('--experimental-test-coverage', '--test-coverage-include=src/**/*.ts');
const result = spawnSync(process.execPath, [...args, ...files], { stdio: 'inherit', windowsHide: true });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
