import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const projectDirectory = process.cwd()
const macScript = join(projectDirectory, 'config', 'scripts', 'package-mac.sh')
const windowsScript = join(projectDirectory, 'config', 'scripts', 'package-windows.ps1')

describe('native desktop package scripts', () => {
  it('prints the complete macOS package plan without executing it', () => {
    const result = spawnSync('sh', [macScript], {
      cwd: projectDirectory,
      encoding: 'utf8',
      env: { ...process.env, MAM_PACKAGE_DRY_RUN: '1' }
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /> pnpm build/)
    assert.match(result.stdout, /electron-builder --mac zip --x64 --publish never/)
    assert.match(result.stdout, /create-mac-dmg\.mjs --arch x64/)
  })

  it('rejects public macOS script arguments', () => {
    const result = spawnSync('sh', [macScript, '--arch', 'arm64'], {
      cwd: projectDirectory,
      encoding: 'utf8',
      env: { ...process.env, MAM_PACKAGE_DRY_RUN: '1' }
    })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /does not accept arguments/)
  })

  it('connects package.json to the native scripts', () => {
    const metadata = JSON.parse(readFileSync(join(projectDirectory, 'package.json'), 'utf8'))
    assert.equal(metadata.scripts['package:mac'], 'sh config/scripts/package-mac.sh')
    assert.match(metadata.scripts['package:win'], /package-windows\.ps1/)
    assert.equal(metadata.build.electronDist, 'node_modules/electron/dist')
    assert.match(readFileSync(windowsScript, 'utf8'), /electron-builder[\s\S]*--win/)
  })

  const powershell = availablePowerShell()
  it('prints the complete Windows package plan without executing it', { skip: !powershell }, () => {
    const result = spawnSync(
      powershell,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', windowsScript],
      {
        cwd: projectDirectory,
        encoding: 'utf8',
        env: { ...process.env, MAM_PACKAGE_DRY_RUN: '1' }
      }
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /> pnpm\.cmd build/)
    assert.match(result.stdout, /electron-builder --win nsis zip --x64 --publish never/)
  })
})

function availablePowerShell() {
  const candidates = process.platform === 'win32' ? ['powershell.exe', 'pwsh.exe'] : ['pwsh']
  return candidates.find((command) => {
    const result = spawnSync(command, ['-NoProfile', '-Command', 'exit 0'])
    return !result.error && result.status === 0
  })
}
