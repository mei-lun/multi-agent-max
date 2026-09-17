import { AttemptResultSchema, type AttemptResult } from '../../../shared/mam/domain/attempt-result'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import { buildTaskDeliveryCommand } from './attempt-result-command'
import type { PreparedAttemptRunnerInput } from './mam-attempt-background-runner'
import type { MamSubmitReviewInput } from '../../../shared/mam/application-command'
import { buildReviewSubmissionCommand } from './mam-review-submission'

export function publishRegularTaskDelivery(
  input: PreparedAttemptRunnerInput,
  result: AttemptResult,
  validArtifactHashes: ReadonlySet<string>,
  automaticReview?: MamSubmitReviewInput
): AttemptResult {
  const finalized = input.worktrees.finalize({
    repositoryPath: input.repository.projectDirectory,
    remoteName: input.repository.remote,
    attemptId: input.prepared.attemptId,
    worktree: input.prepared.worktree,
    retainWorktree: true
  })
  const authoritative = AttemptResultSchema.parse({
    ...result,
    system: { ...result.system, submittedCommit: finalized.submittedCommit }
  })
  const commandId = input.createId('command')
  const command = buildTaskDeliveryCommand(input.prepared, authoritative, commandId, input.now())
  const review =
    automaticReview && input.prepared.task.reviewTask
      ? buildReviewSubmissionCommand({
          request: automaticReview,
          definition: input.prepared.task.reviewTask,
          binding: {
            roleInstanceId: input.prepared.roleInstanceId,
            executorInvocationId: input.prepared.executorInvocationId
          },
          commandId,
          createdAt: command.issuedAt
        }).review
      : undefined
  new GitCommandRetryCoordinator(input.repository).executeAndPush({
    command: { ...command, ...(review ? { review } : {}) },
    schedulerId: input.schedulerId,
    validArtifactHashes,
    effectiveConfigSnapshot: input.prepared.snapshot
  })
  input.worktrees.abandon(input.repository.projectDirectory, input.prepared.worktree)
  return authoritative
}
