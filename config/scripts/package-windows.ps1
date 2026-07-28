Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Architecture = 'x64'
$dryRun = $env:MAM_PACKAGE_DRY_RUN -eq '1'

if ($args.Count -ne 0) {
  throw 'package-windows.ps1 does not accept arguments; x64 packaging is built in.'
}

$isWindows = [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
if (-not $dryRun -and -not $isWindows) {
  throw 'Windows packages must be built on Windows.'
}

$projectDirectory = [System.IO.Path]::GetFullPath(
  (Join-Path (Join-Path $PSScriptRoot '..') '..')
)

function Invoke-PackageStep {
  param(
    [Parameter(Mandatory)]
    [string]$Command,

    [Parameter(Mandatory)]
    [string[]]$Arguments
  )

  Write-Host "> $Command $($Arguments -join ' ')"
  if ($dryRun) { return }

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command exited with status $LASTEXITCODE"
  }
}

Push-Location $projectDirectory
try {
  Invoke-PackageStep -Command 'pnpm.cmd' -Arguments @('build')
  Invoke-PackageStep -Command 'pnpm.cmd' -Arguments @(
    'exec',
    'electron-builder',
    '--win',
    'nsis',
    'zip',
    "--$Architecture",
    '--publish',
    'never'
  )
} finally {
  Pop-Location
}
