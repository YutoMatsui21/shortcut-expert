// Disposable research worker. Default mode performs no Windows/UIA calls.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2] ?? '--self-test';
if (process.platform !== 'win32' || process.argv.length > 3 || !['--self-test', '--snapshot'].includes(mode)) {
  console.error('Windows only. Use --self-test (default) or --snapshot (authorized live research).');
  process.exit(2);
}
const output = path.join(root, '.tools', 'validation', 'task-view');
await mkdir(output, { recursive: true });
const framework = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const probe = path.join(output, 'TaskViewProviderProbe.exe');
const references = ['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(name => `/reference:${path.join(framework, 'WPF', `${name}.dll`)}`);
try {
  await execFileAsync(path.join(framework, 'csc.exe'), [
    '/nologo', '/target:exe', `/out:${probe}`, '/reference:System.Web.Extensions.dll',
    ...references, path.join(root, 'validation', 'probes', 'TaskViewProviderProbe.cs'),
  ], { cwd: root, windowsHide: true, timeout: 30_000 });
  let stdout = '', failed = false;
  try {
    ({ stdout } = await execFileAsync(probe, [mode], { cwd: root, windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }));
  } catch (error) {
    stdout = typeof error.stdout === 'string' ? error.stdout : '';
    failed = true;
  }
  if (mode === '--self-test') {
    const result = failed ? null : JSON.parse(stdout.trim());
    if (result?.kind !== 'self-test' || result.result !== 'PASS' || result.liveObservation !== false) throw new Error('Self-test failed');
    console.log('TASK_VIEW_PROBE_SELF_TEST_OK (no live observation)');
  } else {
    const rows = stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    const end = rows.find(row => row.kind === 'snapshot-end');
    const completed = !failed && Boolean(end);
    const result = { kind: 'worker-result', completed, verdict: 'unknown', selectorVerified: false, originMeasured: false };
    const file = path.join(output, `snapshot-${Date.now()}.jsonl`);
    await writeFile(file, rows.map(row => JSON.stringify(row)).concat(JSON.stringify(result)).join('\n') + '\n', 'utf8');
    console.log(JSON.stringify({ ...result, file, roots: end?.roots ?? null }));
    if (!completed) process.exitCode = 1;
  }
} catch (error) {
  console.error('TASK_VIEW_PROBE_FAILED');
  // Compiler diagnostics concern this source only; avoid dumping runtime/provider errors.
  if (error.path?.endsWith('csc.exe')) console.error(error.stdout || 'Compiler failed');
  process.exitCode = 1;
}
