param([switch]$Dev)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
function Fail([string]$Message) { throw "bootstrap failed: $Message" }
function Invoke-Checked([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { Fail "$Command exited with status $LASTEXITCODE" }
}

if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { Fail 'Git 2.25+ is required.' }
$gitVersionText = & git.exe --version
if ($gitVersionText -notmatch '(\d+)\.(\d+)') { Fail "Could not read Git version from: $gitVersionText" }
$gitReady = [int]$Matches[1] -gt 2 -or ([int]$Matches[1] -eq 2 -and [int]$Matches[2] -ge 25)
if (-not $gitReady) { Fail "Git 2.25+ is required; found $gitVersionText" }
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodeReady = $false
if ($nodeCommand) {
  $nodeReady = (& node.exe -p "(() => { const [a,b] = process.versions.node.split('.').map(Number); return a > 22 || (a === 22 && b >= 22) })()") -eq 'true'
}
if (-not $nodeReady) {
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { Fail 'Node.js 22.22+ is required. Install it from https://nodejs.org/ and rerun.' }
  $wingetAction = if ($nodeCommand) { 'upgrade' } else { 'install' }
  Invoke-Checked 'winget.exe' @($wingetAction, '--id', 'OpenJS.NodeJS.LTS', '--exact', '--accept-source-agreements', '--accept-package-agreements')
  $nodeDirectory = Join-Path ${env:ProgramFiles} 'nodejs'
  if (Test-Path -LiteralPath $nodeDirectory) { $env:Path = "$nodeDirectory;$env:Path" }
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { Fail 'Node.js was installed but is not visible in this terminal. Restart PowerShell and rerun.' }
$nodeReady = (& node.exe -p "(() => { const [a,b] = process.versions.node.split('.').map(Number); return a > 22 || (a === 22 && b >= 22) })()") -eq 'true'
if (-not $nodeReady) { Fail 'Node.js 22.22+ is required. Restart PowerShell after updating Node.js and rerun.' }
if (-not (Get-Command corepack.cmd -ErrorAction SilentlyContinue)) {
  Invoke-Checked 'npm.cmd' @('install', '--global', 'corepack@0.34.1')
  $npmPrefix = & npm.cmd prefix --global
  if ($LASTEXITCODE -ne 0) { Fail 'Could not resolve the npm global prefix after installing Corepack.' }
  $env:Path = "$($npmPrefix.Trim());$env:Path"
}
if (-not (Get-Command corepack.cmd -ErrorAction SilentlyContinue)) { Fail 'Corepack was installed but is not visible in this terminal. Restart PowerShell and rerun.' }

Push-Location $projectDirectory
try {
  $pnpmVersion = & corepack.cmd pnpm --version
  if ($LASTEXITCODE -ne 0 -or $pnpmVersion.Trim() -ne '10.24.0') { Fail "Corepack did not resolve pnpm 10.24.0; found $pnpmVersion" }
  Invoke-Checked 'corepack.cmd' @('pnpm', 'install', '--frozen-lockfile')
  & corepack.cmd pnpm exec node config/scripts/verify-environment.mjs
  $verifyStatus = $LASTEXITCODE
  if ($verifyStatus -eq 2) {
    Write-Host 'Repairing native Electron, esbuild, and SWC artifacts...'
    Invoke-Checked 'corepack.cmd' @('pnpm', 'exec', 'node', 'node_modules/electron/install.js')
    Invoke-Checked 'corepack.cmd' @('pnpm', 'rebuild', '@swc/core', 'esbuild')
    Invoke-Checked 'corepack.cmd' @('pnpm', 'exec', 'node', 'config/scripts/verify-environment.mjs')
  } elseif ($verifyStatus -ne 0) {
    Fail 'Environment verification failed; no native repair was attempted.'
  }
  if ($Dev) { Invoke-Checked 'corepack.cmd' @('pnpm', 'dev') } else { Write-Host 'Environment ready. Run: corepack pnpm dev' }
} finally { Pop-Location }
