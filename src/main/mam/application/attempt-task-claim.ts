import type { TaskClaim } from '../../../shared/mam/domain/task-claim'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import type { GitStateRepository } from '../state-store/git-state-repository'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import { publishAttemptStart } from './attempt-start-publisher'

export function ensureAttemptTaskClaim(input: {
  repository: GitStateRepository
  workflowRunId: string
  taskId: string
  claimantInstanceId: string
  schedulerId: string
  claimId: string
  commandId: string
  issuedAt: string
}): TaskClaim {
  const active = input.repository.rebuild(input.workflowRunId).tasks[input.taskId]?.activeClaim
  if (active) {
    if (active.claimantInstanceId === input.claimantInstanceId) return active
    throw new Error('task_already_claimed')
  }
  new GitCommandRetryCoordinator(input.repository).executeAndPush({
    command: {
      schemaVersion: '1.0.0',
      commandId: input.commandId,
      issuedAt: input.issuedAt,
      workflowRunId: input.workflowRunId,
      taskId: input.taskId,
      actor: { kind: 'scheduler', schedulerId: input.schedulerId },
      type: 'claim_task',
      claimId: input.claimId,
      claimantInstanceId: input.claimantInstanceId
    },
    schedulerId: input.schedulerId
  })
  const claimed = input.repository.rebuild(input.workflowRunId).tasks[input.taskId]?.activeClaim
  if (!claimed || claimed.claimId !== input.claimId) throw new Error('task_claim_not_recorded')
  return claimed
}

export function publishLegacyMergeConflictStart(input: {
  prepared: PreparedAttempt
  repository: GitStateRepository
  schedulerId: string
  issuedAt: string
  createId(kind: string): string
}): void {
  if (input.prepared.task.mergeConflictTask) publishAttemptStart(input)
}

export function claimPreparedAttempt(
  prepared: PreparedAttempt,
  repository: GitStateRepository,
  claimantInstanceId: string,
  schedulerId: string,
  createId: (kind: string) => string,
  issuedAt: string
): PreparedAttempt {
  const claim = ensureAttemptTaskClaim({
    repository,
    workflowRunId: prepared.workflowRunId,
    taskId: prepared.taskId,
    claimantInstanceId,
    schedulerId,
    claimId: createId('claim'),
    commandId: createId('command'),
    issuedAt
  })
  const claimed = { ...prepared, claimId: claim.claimId, claimGeneration: claim.generation }
  publishLegacyMergeConflictStart({
    prepared: claimed,
    repository,
    schedulerId,
    issuedAt,
    createId
  })
  return claimed
}
