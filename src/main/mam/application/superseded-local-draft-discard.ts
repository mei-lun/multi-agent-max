import type { TaskClaim } from '../../../shared/mam/domain/task-claim'
import { existsSync } from 'node:fs'
import type { AttemptWorktreeManager } from './attempt-worktree-manager'
import type { LocalExecutionDraftStore } from './local-execution-draft-store'

export function discardSupersededLocalDrafts(input: {
  store: LocalExecutionDraftStore
  worktrees: AttemptWorktreeManager
  repositoryPath: string
  workflowRunId: string
  taskId: string
  activeClaim: TaskClaim | undefined
  claimantInstanceId: string
}): void {
  const claim = input.activeClaim
  if (claim && claim.claimantInstanceId !== input.claimantInstanceId) return
  for (const draft of input.store.listUnfinished()) {
    if (draft.workflowRunId !== input.workflowRunId || draft.taskId !== input.taskId) continue
    if (claim && draft.claimId === claim.claimId && draft.claimGeneration === claim.generation)
      continue
    if (
      existsSync(draft.worktreePath) &&
      !input.worktrees.abandon(input.repositoryPath, {
        path: draft.worktreePath,
        branch: draft.worktreeBranch,
        baseCommit: draft.baseCommit
      })
    )
      throw new Error('superseded_draft_discard_failed')
    input.store.remove(draft.id)
  }
}
