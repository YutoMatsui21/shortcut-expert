import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const localSdk = resolve('.tools/dotnet/dotnet.exe');
const dotnet = existsSync(localSdk) ? localSdk : 'dotnet';
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
  env: {
    ...process.env,
    DOTNET_CLI_HOME: resolve('.tools/dotnet-home'),
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
    DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false',
    DOTNET_ADD_GLOBAL_TOOLS_TO_PATH: 'false',
    NUGET_PACKAGES: resolve('.tools/nuget'),
    NUGET_HTTP_CACHE_PATH: resolve('.tools/nuget-http-cache')
  }
});
if (result.error) console.error(result.error.message);
if (result.status === 0) {
  // Replace only after a successful publish; obsolete dependency files cannot survive.
  mkdirSync(dirname(output), { recursive: true });
  rmSync(output, { recursive: true, force: true });
  renameSync(staging, output);
}
process.exit(result.status ?? 1);
