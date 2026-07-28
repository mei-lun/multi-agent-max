import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { parseValidationCommand } from './validation-command-parser'

export type ValidationCommandResult = Readonly<{
  command: string
  exitCode: number | null
  stdout: string
  stderr: string
  evidenceHash: string
}>

export type ValidationCommandRunner = (
  command: string,
  workingDirectory: string
) => ValidationCommandResult

export function runValidationCommand(
  command: string,
  workingDirectory: string
): ValidationCommandResult {
  const parsed = parseValidationCommand(command)
  const result = spawnSync(parsed.executable, [...parsed.arguments], {
    cwd: workingDirectory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10 * 60 * 1000,
    maxBuffer: 1024 * 1024,
    shell: process.platform === 'win32'
  })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr || result.error?.message || ''
  return {
    command,
    exitCode: result.status,
    stdout: truncate(stdout),
    stderr: truncate(stderr),
    evidenceHash: createHash('sha256')
      .update(JSON.stringify({ command, exitCode: result.status, stdout, stderr }))
      .digest('hex')
  }
}

function truncate(value: string): string {
  return value.length <= 16_384 ? value : `${value.slice(0, 16_384)}\n[output truncated]`
}
