// Opt-in research runner. Default compiles and self-tests without live observation.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2] ?? '--self-test';
if (process.platform !== 'win32' || process.argv.length > 3 || !['--self-test', '--sample'].includes(mode)) {
  console.error('Use --self-test (default) or --sample (explicit consent required).');
  process.exit(2);
}
const output = path.join(root, '.tools/validation/snap-layout');
await mkdir(output, { recursive: true });
const framework = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319');
const source = path.join(root, 'validation/probes/SnapLayoutProbe.cs');
const probe = path.join(output, 'SnapLayoutProbe.exe');
const refs = ['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(name => `/reference:${path.join(framework, 'WPF', `${name}.dll`)}`);
await run(path.join(framework, 'csc.exe'), ['/nologo', '/target:exe', `/out:${probe}`,
  '/reference:System.Web.Extensions.dll', '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:Accessibility.dll', ...refs, source],
{ windowsHide: true, timeout: 30_000 }).catch(error => { console.error(error.stdout); process.exit(1); });
if (mode === '--self-test') {
  const { stdout } = await run(probe, ['--self-test'], { windowsHide: true, timeout: 5_000 });
  const result = JSON.parse(stdout);
  if (result.result !== 'PASS' || result.liveObservation !== false) throw new Error('Self-test failed');
  console.log('SNAP_LAYOUT_PROBE_SELF_TEST_OK (no live observation)');
} else {
  // This mode explicitly opens an interactive fixture window for the operator.
  const target = spawn(probe, ['--target'], { windowsHide: false, stdio: ['ignore', 'pipe', 'ignore'] });
  let targetExited = false;
  target.on('exit', () => { targetExited = true; });
  const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
  const rows = [{ kind: 'research-session', sourceSha256: await hash(source), probeSha256: await hash(probe),
    durationLimitSeconds: 90, selectorVerified: false, originMeasured: false }];
  const file = path.join(output, `sampling-${Date.now()}.jsonl`);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Target window did not become ready')), 5_000);
      let pending = '';
      const finish = error => { clearTimeout(timer); error ? reject(error) : resolve(); };
      target.once('error', () => finish(new Error('Target failed to launch')));
      target.once('exit', () => finish(new Error('Target exited')));
      target.stdout.on('data', chunk => {
        pending += chunk.toString();
        if (pending.includes('"kind":"target-ready"')) finish();
      });
    });
    console.log('SAMPLING_READY: use isolated target for hover / dismiss / Win+Z / Esc; 90 seconds maximum.');
    const start = Date.now();
    let consecutiveFailures = 0;
    while (!targetExited && Date.now() - start < 90_000) {
      let stdout = '', completed = true;
      try { ({ stdout } = await run(probe, ['--snapshot', String(target.pid)], {
        windowsHide: true, timeout: Math.min(5_000, 90_000 - (Date.now() - start)), maxBuffer: 4 * 1024 * 1024,
      })); } catch (error) { stdout = error.stdout ?? ''; completed = false; }
      const snapshot = [];
      for (const line of stdout.trim().split(/\r?\n/).filter(Boolean)) {
        try { snapshot.push(JSON.parse(line)); } catch { completed = false; }
      }
      rows.push({ kind: 'sample', index: rows.length - 1, workerCompleted: completed,
        hasEnd: snapshot.some(row => row.kind === 'snapshot-end'), rows: snapshot });
      await writeFile(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');
      consecutiveFailures = completed && snapshot.some(row => row.kind === 'snapshot-end') ? 0 : consecutiveFailures + 1;
      if (consecutiveFailures >= 3) throw new Error('Three workers failed; stop and diagnose target/provider access');
      await delay(Math.min(500, Math.max(0, 90_000 - (Date.now() - start))));
    }
  } finally {
    if (!targetExited) target.kill();
    await writeFile(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  }
  console.log(JSON.stringify({ file, samples: rows.length - 1, verdict: 'unknown', selectorVerified: false, originMeasured: false }));
}
