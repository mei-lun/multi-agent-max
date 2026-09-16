import type { GitStateRepository } from '../state-store/git-state-repository'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import { schedulerEnvelope } from './scheduler-envelope'

export function publishAttemptStart(input: {
  repository: GitStateRepository
  prepared: PreparedAttempt
  schedulerId: string
  issuedAt: string
  createId(kind: string): string
}): void {
  const coordinator = new GitCommandRetryCoordinator(input.repository)
  coordinator.executeAndPush({
    command: {
      ...schedulerEnvelope(
        input.prepared,
        input.createId('command'),
        input.issuedAt,
        input.schedulerId
      ),
      type: 'announce_execution',
      claimId: input.createId('claim'),
      attemptId: input.prepared.attemptId,
      ...(input.prepared.previousAttemptId
        ? { previousAttemptId: input.prepared.previousAttemptId }
        : {}),
      executorInstanceId: input.createId('executor-instance')
    },
    schedulerId: input.schedulerId
  })
  coordinator.executeAndPush({
    command: {
      ...schedulerEnvelope(
        input.prepared,
        input.createId('command'),
        input.issuedAt,
        input.schedulerId
      ),
      type: 'start_attempt',
      attemptId: input.prepared.attemptId,
      roleInstanceId: input.prepared.roleInstanceId,
      executorInvocationId: input.prepared.executorInvocationId,
      effectiveConfigSnapshotId: input.prepared.snapshot.id,
      effectiveConfigHash: input.prepared.snapshot.contentHash
    },
    schedulerId: input.schedulerId,
    effectiveConfigSnapshot: input.prepared.snapshot
  })
}
