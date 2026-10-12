import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const localSdk = resolve('.tools/dotnet/dotnet.exe');
export const dotnet = existsSync(localSdk) ? localSdk : 'dotnet';
export const dotnetEnvironment = {
  ...process.env,
  DOTNET_CLI_HOME: resolve('.tools/dotnet-home'),
  DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
  DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false', DOTNET_ADD_GLOBAL_TOOLS_TO_PATH: 'false',
  NUGET_PACKAGES: resolve('.tools/nuget'), NUGET_HTTP_CACHE_PATH: resolve('.tools/nuget-http-cache')
};
