import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import type { GitStateRepository } from '../state-store/git-state-repository'

export type AttemptInterruptionRecoveryStatus =
  | 'needs_reconciliation_recorded'
  | 'replacement_attempt_planned'
  | 'attempt_no_longer_active'

export function recordAttemptInterruption(input: {
  repository: GitStateRepository
  workflowRunId: string
  taskId: string
  attemptId: string
  schedulerId: string
  commandId: string
  issuedAt: string
  replacementAttemptId?: string
}): AttemptInterruptionRecoveryStatus {
  const attempt = input.repository.rebuild(input.workflowRunId).attempts[input.attemptId]
  if (!attempt || (attempt.status !== 'announced' && attempt.status !== 'running')) {
    return 'attempt_no_longer_active'
  }
  new GitCommandRetryCoordinator(input.repository).executeAndPush({
    command: recoveryCommand(input),
    schedulerId: input.schedulerId
  })
  return input.replacementAttemptId
    ? 'replacement_attempt_planned'
    : 'needs_reconciliation_recorded'
}

function recoveryCommand(
  input: Parameters<typeof recordAttemptInterruption>[0]
): Extract<SchedulerCommand, { type: 'recover_attempt' }> {
  return {
    schemaVersion: '1.0.0',
    commandId: input.commandId,
    issuedAt: input.issuedAt,
    workflowRunId: input.workflowRunId,
    taskId: input.taskId,
    actor: { kind: 'scheduler', schedulerId: input.schedulerId },
    type: 'recover_attempt',
    previousAttemptId: input.attemptId,
    directive: input.replacementAttemptId
      ? { kind: 'start_new_attempt', newAttemptId: input.replacementAttemptId }
      : { kind: 'needs_reconciliation' },
    reason: input.replacementAttemptId
      ? 'Executor completed, but local result validation failed safely; retry within the frozen Role policy.'
      : 'Executor stopped without a terminal Attempt Result; verify side effects before replay.'
  }
}
