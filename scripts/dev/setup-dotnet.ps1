$ErrorActionPreference = 'Stop'
$setupWorkspace = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$setupTools = Join-Path $setupWorkspace '.tools'
$setupInstaller = Join-Path $setupTools 'dotnet-install.ps1'
$setupSdkVersion = (Get-Content -LiteralPath (Join-Path $setupWorkspace 'global.json') -Raw | ConvertFrom-Json).sdk.version
New-Item -ItemType Directory -Force -Path $setupTools | Out-Null
Invoke-WebRequest -Uri 'https://dot.net/v1/dotnet-install.ps1' -OutFile $setupInstaller
& $setupInstaller -Version $setupSdkVersion -InstallDir (Join-Path $setupTools 'dotnet') -NoPath
& (Join-Path $setupTools 'dotnet\dotnet.exe') --version
exit $LASTEXITCODE
