import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { developmentEnvironment } from '../dev/dev-environment.mjs';
import { packageManifest, waitForUiAcceptance } from './ui-acceptance-runtime.mjs';

const option = process.argv.indexOf('--package-dir');
if (option < 0 || !process.argv[option + 1]) throw new Error('Pass --package-dir release/<build>');
const packageDirectory = resolve(process.argv[option + 1], 'win-unpacked');
const executable = join(packageDirectory, 'Window Shortcut Coach.exe');
const environment = developmentEnvironment();
mkdirSync(resolve('.tools/tests'), { recursive: true });
const directory = mkdtempSync(join(resolve('.tools/tests'), 'ui-acceptance-'));
environment.COACH_TEST_DATA_DIR = directory;
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.ELECTRON_RENDERER_URL;
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const build = { fixtureOnly:true, directory, executable, node:process.version,
  hashes:{ executable:sha256(executable), asar:sha256(join(packageDirectory,'resources/app.asar')),
    helper:sha256(join(packageDirectory,'resources/native-helper/WindowObserver.exe')) } };
const manifest = packageManifest(packageDirectory);
const manifestSha256 = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
writeFileSync(join(directory,'package-manifest.json'),JSON.stringify({sha256:manifestSha256,files:manifest},null,2));
Object.assign(build,{manifestSha256,manifestFiles:manifest.length});
writeFileSync(join(directory,'build.json'),JSON.stringify(build,null,2));
console.log(JSON.stringify(build));
const child = spawn(executable, ['--ui-acceptance', ...(process.argv.includes('--matrix-only') ? ['--ui-acceptance-exit'] : [])],
  {env:environment,windowsHide:false,stdio:['ignore','pipe','pipe']});
const log = chunk => { process.stdout.write(chunk); appendFileSync(join(directory,'session.log'),chunk); };
process.exitCode = await waitForUiAcceptance(child,log,process.argv.includes('--matrix-only') ? 60_000 : 0);
