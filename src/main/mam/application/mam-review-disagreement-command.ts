import { MamResolveReviewDisagreementInputSchema } from '../../../shared/mam/application-command'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import type { GitStateRepository } from '../state-store/git-state-repository'
import { publishMergeReadinessIfEligible } from './merge-readiness-publisher'
import { advanceDeterministicNodes } from './deterministic-node-advancement'

export class MamReviewDisagreementCommandError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'MamReviewDisagreementCommandError'
  }
}

export function resolveReviewDisagreementAndPublishMerge(input: {
  request: unknown
  repository: GitStateRepository
  schedulerId: string
  userId: string
  nextCommandId(): string
  now(): string
}): void {
  const request = MamResolveReviewDisagreementInputSchema.parse(input.request)
  const aggregation = input.repository.rebuild(request.workflowRunId).reviewAggregations[
    request.aggregationId
  ]
  if (!aggregation) {
    throw new MamReviewDisagreementCommandError(
      'review_aggregation_not_found',
      'The Review aggregation is unavailable'
    )
  }
  new GitCommandRetryCoordinator(input.repository).executeAndPush({
    command: resolveCommand({
      request,
      commandId: input.nextCommandId(),
      issuedAt: input.now(),
      userId: input.userId
    }),
    schedulerId: input.schedulerId
  })
  if (request.selectedStatus === 'approved') {
    publishMergeReadinessIfEligible({
      repository: input.repository,
      workflowRunId: request.workflowRunId,
      taskId: aggregation.subject.taskId,
      schedulerId: input.schedulerId,
      commandId: input.nextCommandId(),
      issuedAt: input.now()
    })
  }
  advanceDeterministicNodes({
    repository: input.repository,
    workflowRunId: request.workflowRunId,
    schedulerId: input.schedulerId,
    nextCommandId: input.nextCommandId,
    now: input.now
  })
}

function resolveCommand(input: {
  request: ReturnType<typeof MamResolveReviewDisagreementInputSchema.parse>
  commandId: string
  issuedAt: string
  userId: string
}): SchedulerCommand {
  return {
    schemaVersion: '1.0.0',
    commandId: input.commandId,
    issuedAt: input.issuedAt,
    workflowRunId: input.request.workflowRunId,
    actor: { kind: 'user', userId: input.userId },
    type: 'resolve_approval_gate',
    gateId: `gate.${input.request.aggregationId}`,
    option: input.request.selectedStatus
  }
}
