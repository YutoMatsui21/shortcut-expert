$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

$installer = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$installation = & $installer -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$installation) {
    throw 'Visual Studio x64 C tools are required to build the Observer fixture.'
}

$output = Join-Path (Get-Location) '.tools/sonar-observer'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$env:OBSERVER_FIXTURE_VCVARS = Join-Path $installation 'VC/Auxiliary/Build/vcvars64.bat'
$env:OBSERVER_FIXTURE_SOURCE = Join-Path $PSScriptRoot 'observer-win32.c'
Push-Location $output
try {
    cmd.exe /d /c 'call "%OBSERVER_FIXTURE_VCVARS%" > nul && cl /nologo /std:c17 /LD "%OBSERVER_FIXTURE_SOURCE%" /link /out:observer-win32.dll'
} finally {
    Pop-Location
}
