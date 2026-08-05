import { parseValidationCommand } from './validation-command-parser'
import { profileContentHash } from '../profiles/profile-content-hash'

const COMMAND_RUNNERS = new Set([
  'bash',
  'bun',
  'cargo',
  'cmd',
  'cmake',
  'deno',
  'dotnet',
  'git',
  'go',
  'gradle',
  'make',
  'mvn',
  'node',
  'npm',
  'npx',
  'pnpm',
  'powershell',
  'pwsh',
  'pytest',
  'python',
  'python3',
  'sh',
  'swift',
  'uv',
  'yarn',
  'zsh'
])

export function executableMergeValidationCommands(values: readonly string[]): readonly string[] {
  return values.filter(isExecutableMergeValidationCommand)
}

export function mergeValidationEvidence(
  values: readonly string[],
  submittedCommit: string | undefined
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    executableMergeValidationCommands(values).map((command) => [
      command,
      profileContentHash({ command, submittedCommit, phase: 'post_merge_validation' })
    ])
  )
}

export function isExecutableMergeValidationCommand(value: string): boolean {
  try {
    const { executable } = parseValidationCommand(value)
    return (
      COMMAND_RUNNERS.has(executable.toLocaleLowerCase()) ||
      executable.startsWith('.') ||
      executable.includes('/') ||
      executable.includes('\\')
    )
  } catch {
    return false
  }
}
