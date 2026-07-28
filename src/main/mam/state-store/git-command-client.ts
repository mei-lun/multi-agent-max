import { spawnSync } from 'node:child_process'

export class GitCommandError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stderr: string
  ) {
    super(stderr || `git ${args.join(' ')} failed`)
    this.name = 'GitCommandError'
  }
}

export type GitCommandClient = Readonly<{
  run(cwd: string, args: readonly string[]): string
  runRaw(cwd: string, args: readonly string[]): string
  succeeds(cwd: string, args: readonly string[]): boolean
}>

export function createGitCommandClient(executable = 'git'): GitCommandClient {
  return {
    run(cwd, args) {
      const result = execute(executable, cwd, args)
      if (result.status !== 0) {
        throw new GitCommandError(args, result.status, result.stderr.trim())
      }
      return result.stdout.trim()
    },
    runRaw(cwd, args) {
      const result = execute(executable, cwd, args)
      if (result.status !== 0) {
        throw new GitCommandError(args, result.status, result.stderr.trim())
      }
      return result.stdout
    },
    succeeds(cwd, args) {
      return execute(executable, cwd, args).status === 0
    }
  }
}

function execute(executable: string, cwd: string, args: readonly string[]) {
  return spawnSync(executable, ['-c', 'maintenance.auto=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
}
