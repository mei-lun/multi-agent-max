import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  electronExecutablePath,
  corepackCommand,
  isVersionAtLeast,
  parseVersion,
  readNodeMinimum,
  readPackageManager
} from './verify-environment.mjs'

describe('environment version declarations', () => {
  it('selects the platform Corepack command', () => {
    assert.equal(corepackCommand('win32'), 'corepack.cmd')
    assert.equal(corepackCommand('darwin'), 'corepack')
  })
  it('parses semantic versions without accepting arbitrary text', () => {
    assert.deepEqual(parseVersion('22.22.0'), [22, 22, 0])
    assert.deepEqual(parseVersion('10.24'), [10, 24, 0])
    assert.equal(parseVersion('version 22'), null)
    assert.equal(parseVersion('22.22.0-preview'), null)
  })

  it('compares versions from most significant component to least', () => {
    assert.equal(isVersionAtLeast('22.22.0', '22.22.0'), true)
    assert.equal(isVersionAtLeast('23.0.0', '22.22.0'), true)
    assert.equal(isVersionAtLeast('22.21.99', '22.22.0'), false)
    assert.equal(isVersionAtLeast('21.99.99', '22.22.0'), false)
  })

  it('reads supported package declarations', () => {
    assert.equal(readNodeMinimum('>=22.22'), '22.22')
    assert.equal(readPackageManager('pnpm@10.24.0'), '10.24.0')
    assert.throws(() => readNodeMinimum('^22.22'), /Unsupported Node engine/)
    assert.throws(() => readPackageManager('npm@10.0.0'), /Expected packageManager/)
  })
})

describe('Electron installation validation', () => {
  it('resolves the Windows executable below dist', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mam-electron-'))
    mkdirSync(join(directory, 'dist'))
    writeFileSync(join(directory, 'path.txt'), 'electron.exe')
    const executable = join(directory, 'dist', 'electron.exe')
    writeFileSync(executable, '')
    chmodSync(executable, 0o755)
    assert.equal(electronExecutablePath(directory, 'win32'), executable)
  })

  it('rejects unexpected path.txt contents', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mam-electron-'))
    writeFileSync(join(directory, 'path.txt'), '..\\outside.exe')
    assert.throws(
      () => electronExecutablePath(directory, 'win32'),
      /does not point to electron.exe/
    )
  })
})
