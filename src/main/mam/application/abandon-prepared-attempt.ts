import type { GitStateRepository } from '../state-store/git-state-repository'
import type { AttemptWorktreeManager } from './attempt-worktree-manager'
import type { ConflictResolutionWorktreeManager } from './conflict-resolution-worktree-manager'
import type { PreparedAttempt } from './mam-attempt-execution-types'

export function abandonPreparedAttempt(input: {
  prepared: PreparedAttempt
  repository: GitStateRepository
  worktrees: AttemptWorktreeManager
  conflicts: ConflictResolutionWorktreeManager
  workspaceRoot: string
}): void {
  if (input.prepared.task.mergeConflictTask) {
    input.conflicts.abandon({
      repositoryPath: input.repository.projectDirectory,
      integrationRoot: input.workspaceRoot,
      remoteName: input.repository.remote,
      task: input.prepared.task.mergeConflictTask
    })
  } else {
    input.worktrees.abandon(input.repository.projectDirectory, input.prepared.worktree)
  }
}
