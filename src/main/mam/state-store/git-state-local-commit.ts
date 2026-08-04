import type { GitCommandClient } from './git-command-client'
import { GitStateRepositoryError } from './git-state-repository-error'

export function publishDetachedLocalStateCommit(input: {
  stateDirectory: string
  branch: string
  commit: string
  expectedParentCommit: string
  git: GitCommandClient
}): void {
  if (input.git.succeeds(input.stateDirectory, ['symbolic-ref', '--quiet', 'HEAD'])) return
  try {
    input.git.run(input.stateDirectory, [
      'update-ref',
      `refs/heads/${input.branch}`,
      input.commit,
      input.expectedParentCommit
    ])
  } catch (error) {
    throw new GitStateRepositoryError('local_non_fast_forward', String(error))
  }
}
