// Open only disposable own windows. No input observation and no taskbar settings changes.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const count = Number(process.argv[2] ?? 3);
if (process.platform !== 'win32' || process.argv.length > 3 || !Number.isInteger(count) || count < 1 || count > 24) throw new Error('Specify fixture count 1..24 (default 3).');
const output = path.join(root, '.tools/validation/taskbar-input');
await mkdir(output, { recursive: true });
const exe = path.join(output, 'TaskbarNumberFixture.exe');
const csc = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
await promisify(execFile)(csc, ['/nologo', '/target:winexe', `/out:${exe}`, '/reference:System.Windows.Forms.dll',
  '/reference:System.Drawing.dll', path.join(root, 'validation/probes/TaskbarNumberFixture.cs')], { windowsHide: true, timeout: 30_000 });
const children = [];
const timer = setTimeout(() => { for (const child of children) child.kill(); }, 1_200_000);
try {
  const completions = [];
  for (let index = 1; index <= count; index++) {
    const child = spawn(exe, [String(index)], { windowsHide: false, stdio: 'ignore' });
    children.push(child);
    completions.push(new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Fixture ${index}: ${code}/${signal}`)));
    }));
  }
  console.log(`W12_NUMBER_FIXTURES_OPEN: ${count}; close the fixture windows when done (20 minute limit).`);
  await Promise.all(completions);
} finally { clearTimeout(timer); for (const child of children) if (child.exitCode === null) child.kill(); }
