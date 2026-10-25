// Research only. Default: compile + fixtures. Live mode requires consent and manual ARM.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2] ?? '--self-test';
if (process.platform !== 'win32' || process.argv.length > 3 || !['--self-test', '--observe-consented'].includes(mode)) {
  throw new Error('Use --self-test or --observe-consented (explicit consent required).');
}
const run = promisify(execFile);
const output = path.join(root, '.tools/validation/taskbar-input');
await mkdir(output, { recursive: true });
const source = path.join(root, 'validation/probes/TaskbarInputProbe.cs');
const bytes = await readFile(source);
const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
const snapshot = path.join(output, `source-${sourceSha256}.cs`);
await writeFile(snapshot, bytes);
const probe = path.join(output, `TaskbarInputProbe-${sourceSha256}.exe`);
const framework = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319');
const refs = ['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(name => `/reference:${path.join(framework, 'WPF', `${name}.dll`)}`);
try {
  await run(path.join(framework, 'csc.exe'), ['/nologo', '/target:exe', '/platform:x64', `/out:${probe}`,
    '/reference:System.Web.Extensions.dll', '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', ...refs, snapshot],
  { windowsHide: true, timeout: 30_000 });
} catch (error) { console.error(error.stdout); process.exit(1); }
const { stdout } = await run(probe, ['--self-test'], { windowsHide: true, timeout: 5_000 });
if (!stdout.includes('TASKBAR_INPUT_SELF_TEST_OK')) throw new Error('Fixture self-test failed');
console.log(stdout.trim());
if (mode === '--observe-consented') {
  const file = path.join(output, `trials-${Date.now()}.jsonl`);
  await writeFile(file, JSON.stringify({ kind: 'session', sourceSha256,
    probeSha256: createHash('sha256').update(await readFile(probe)).digest('hex'),
    consentRequired: true, trialLimitSeconds: 30, sessionLimitSeconds: 1200, productChanged: false }) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ file, instructions: 'Select case + expected slot, ARM, perform one manual case, FINISH. Close panel when done.' }));
  const child = spawn(probe, [mode, file], { windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  const timer = setTimeout(() => child.kill(), 1_200_000);
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Incomplete session: ${code}/${signal}; discard unfinished trial`)));
    });
  } finally { clearTimeout(timer); }
}
