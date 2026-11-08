import { expect, test } from 'vitest'
import { runValidationCommand } from './validation-command-runner'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('passes quoted JavaScript arguments directly without shell reinterpretation', () => {
  const command = `"${process.execPath}" -e "process.stdout.write('quoted value'); process.exit(7)"`
  const result = runValidationCommand(command, process.cwd())
  expect(result.stdout).toBe('quoted value')
  expect(result.exitCode).toBe(7)
  expect(result.evidenceHash).toMatch(/^[a-f0-9]{64}$/)
})

test.skipIf(process.platform !== 'win32')(
  'runs Windows command shims with preserved arguments and failure status',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'validation shim '))
    try {
      const shim = join(root, 'check.cmd')
      writeFileSync(shim, `@echo off\r\n"${process.execPath}" %*\r\n`, 'utf8')
      const result = runValidationCommand(
        `"${shim}" -e "process.stdout.write('quoted value'); process.exit(7)"`,
        root
      )
      expect(result.exitCode).toBe(7)
      expect(result.stdout).toBe('quoted value')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
)
