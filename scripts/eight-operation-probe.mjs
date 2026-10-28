import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2] ?? '--self-test';
if (process.platform !== 'win32' || process.argv.length > 3 || !['--self-test', '--observe-consented'].includes(mode)) {
  throw new Error('Use --self-test or --observe-consented (explicit consent required).');
}
const run = promisify(execFile);
const output = path.join(root, '.tools/validation/eight-operation');
await mkdir(output, { recursive: true });
const bytes = await readFile(path.join(root, 'validation/probes/EightOperationProbe.cs'));
const sha = value => createHash('sha256').update(value).digest('hex');
const sourceSha256 = sha(bytes);
const source = path.join(output, `source-${sourceSha256}.cs`);
const probe = path.join(output, `EightOperationProbe-${sourceSha256}.exe`);
await writeFile(source, bytes);
const compiler = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
try {
  await run(compiler, ['/nologo', '/target:exe', '/platform:x64', `/out:${probe}`,
    '/reference:System.Web.Extensions.dll', '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', source],
  { windowsHide: true, timeout: 30_000 });
} catch (error) { console.error(error.stdout); throw error; }
const { stdout } = await run(probe, ['--self-test'], { windowsHide: true, timeout: 5_000 });
if (!stdout.includes('EIGHT_OPERATION_SELF_TEST_OK')) throw new Error('Fixture self-test failed');
console.log(stdout.trim());
const probeSha256 = sha(await readFile(probe));
console.log(JSON.stringify({ sourceSha256, probeSha256, mode }));
if (mode === '--observe-consented') {
  const file = path.join(output, `trials-${Date.now()}.jsonl`);
  await writeFile(file, JSON.stringify({ kind: 'session', sourceSha256, probeSha256,
    scope: 'owned-windows-only', consentRequired: true, productChanged: false }) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ file, instructions: 'Select case; Prepare; ARM; focus Target A; wait 5s; perform one case; FINISH.' }));
  const child = spawn(probe, [mode, file, String(process.pid)], { windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  const timer = setTimeout(() => child.kill(), 1_210_000);
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Incomplete session: ${code}/${signal}; unfinished trial is not evidence`)));
    });
  } finally { clearTimeout(timer); }
}
