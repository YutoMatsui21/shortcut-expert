// Research only; live observation requires explicit consent and manual arming in the panel.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const mode = process.argv[2] ?? '--self-test';
if (process.platform !== 'win32' || process.argv.length > 3 || !['--self-test', '--query-self-test', '--geometry-self-test', '--observe-consented'].includes(mode)) {
  throw new Error('Use --self-test, --query-self-test, --geometry-self-test or --observe-consented (explicit consent required).');
}
const output = path.join(root, '.tools/validation/snap-invocation');
await mkdir(output, { recursive: true });
const source = path.join(root, 'validation/probes/SnapInvocationProbe.cs');
const sourceBytes = await readFile(source);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
const sourceSnapshot = path.join(output, `source-${sourceSha256}.cs`);
await writeFile(sourceSnapshot, sourceBytes);
const probe = path.join(output, `SnapInvocationProbe-${sourceSha256}.exe`);
const csc = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
try {
  await run(csc, ['/nologo', '/target:exe', '/platform:x64', `/out:${probe}`, '/reference:System.Web.Extensions.dll',
    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', sourceSnapshot], { windowsHide: true, timeout: 30_000 });
} catch (error) {
  console.error(error.stdout ?? 'Compilation failed');
  process.exit(1);
}
const { stdout } = await run(probe, ['--self-test'], { windowsHide: true, timeout: 5_000 });
if (!stdout.includes('SNAP_INVOCATION_SELF_TEST_OK')) throw new Error('Self-test did not complete');
console.log(stdout.trim());
if (mode === '--query-self-test') {
  const result = await run(probe, [mode], { windowsHide: true, timeout: 8_000 });
  if (!result.stdout.includes('SNAP_INVOCATION_QUERY_SELF_TEST_OK')) throw new Error('Query fixture did not complete');
  console.log(result.stdout.trim());
}
if (mode === '--geometry-self-test') {
  const result = await run(probe, [mode], { windowsHide: false, timeout: 8_000 });
  if (!result.stdout.includes('SNAP_INVOCATION_GEOMETRY_SELF_TEST_COMPLETE')) throw new Error('Geometry fixture did not complete');
  console.log(result.stdout.trim());
}
if (mode === '--observe-consented') {
  const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
  const file = path.join(output, `trials-${Date.now()}.jsonl`);
  await writeFile(file, JSON.stringify({ kind: 'session', sourceSha256, probeSha256: await hash(probe),
    consentRequired: true, trialLimitSeconds: 60, sessionLimitSeconds: 1200, productChanged: false }) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ file, instructions: 'Verify both windows are visible. Arm manually; close panel to finish. Settings are read only.' }));
  const child = spawn(probe, [mode, file], { windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  const timer = setTimeout(() => child.kill(), 1_200_000);
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Probe incomplete: code=${code}, signal=${signal}; discard any unfinished trial`)));
    });
  } finally { clearTimeout(timer); }
}
