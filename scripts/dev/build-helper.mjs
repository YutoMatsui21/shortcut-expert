import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dotnet, dotnetEnvironment } from 'dotnet.mjs';

const root = resolve('.');
const staging = resolve('.tools/native-publish');
const output = resolve('resources/native-helper');
for (const target of [staging, output]) {
  const path = relative(root, target);
  if (!path || path.startsWith('..') || isAbsolute(path)) throw new Error('Publish path outside project');
}
rmSync(staging, { recursive: true, force: true });
const result = spawnSync(dotnet, [
  'publish', 'native-helper/WindowObserver.csproj', '-c', 'Release',
  '-r', 'win-x64', '--self-contained', 'true', '-o', staging
], {
  stdio: 'inherit', windowsHide: true,
  env: dotnetEnvironment
});
if (result.error) console.error(result.error.message);
if (result.status === 0) {
  // Replace only after a successful publish; obsolete dependency files cannot survive.
  mkdirSync(dirname(output), { recursive: true });
  rmSync(output, { recursive: true, force: true });
  renameSync(staging, output);
}
process.exit(result.status ?? 1);
