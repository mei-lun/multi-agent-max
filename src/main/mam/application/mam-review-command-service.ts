import { MamSubmitReviewInputSchema } from '../../../shared/mam/application-command'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import type { GitStateRepository } from '../state-store/git-state-repository'
import { publishReviewAggregationIfReady } from './review-aggregation-publisher'
import { buildReviewSubmissionCommand } from './mam-review-submission'
import { publishMergeReadinessIfEligible } from './merge-readiness-publisher'
import { advanceDeterministicNodes } from './deterministic-node-advancement'

export function submitReviewAndAggregate(input: {
  request: unknown
  repository: GitStateRepository
  schedulerId: string
  nextCommandId(): string
  now(): string
}): void {
  const request = MamSubmitReviewInputSchema.parse(input.request)
  const projection = input.repository.rebuild(request.workflowRunId)
  const definition = projection.reviewTasks[request.reviewerTaskId]
  const attempt = projection.attempts[request.reviewerAttemptId]
  if (!definition || !attempt || attempt.taskId !== request.reviewerTaskId) {
    throw new MamReviewCommandError(
      'review_attempt_not_found',
      'The reviewer Attempt is not bound to this Review Task'
    )
  }
  if (!attempt.roleInstanceId || !attempt.executorInvocationId) {
    throw new MamReviewCommandError(
      'review_attempt_not_started',
      'The Review Task needs a started Attempt before it can submit a decision'
    )
  }
  const createdAt = input.now()
  new GitCommandRetryCoordinator(input.repository).executeAndPush({
    command: buildReviewSubmissionCommand({
      request,
      definition,
      binding: {
        roleInstanceId: attempt.roleInstanceId,
        executorInvocationId: attempt.executorInvocationId
      },
      commandId: input.nextCommandId(),
      createdAt
    }),
    schedulerId: input.schedulerId
  })
  const aggregated = publishReviewAggregationIfReady({
    repository: input.repository,
    workflowRunId: request.workflowRunId,
    reviewNodeId: definition.reviewNodeId,
    subject: definition.subject,
    schedulerId: input.schedulerId,
    commandId: input.nextCommandId(),
    issuedAt: input.now()
  })
  if (aggregated) {
    publishMergeReadinessIfEligible({
      repository: input.repository,
      workflowRunId: request.workflowRunId,
      taskId: definition.subject.taskId,
      schedulerId: input.schedulerId,
      commandId: input.nextCommandId(),
      issuedAt: input.now()
    })
    advanceDeterministicNodes({
      repository: input.repository,
      workflowRunId: request.workflowRunId,
      schedulerId: input.schedulerId,
      nextCommandId: input.nextCommandId,
      now: input.now
    })
  }
}

export class MamReviewCommandError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'MamReviewCommandError'
  }
}
