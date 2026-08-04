import { GitCommandError } from './git-command-client'

export class GitStateRepositoryError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'GitStateRepositoryError'
  }
}

export function isGitNonFastForward(error: unknown): boolean {
  const detail =
    error instanceof GitCommandError ? `${error.stderr}\n${error.message}` : String(error)
  return /non-fast-forward|fetch first|\[rejected\]/i.test(detail)
}
