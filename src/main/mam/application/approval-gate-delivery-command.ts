import { MamResolveApprovalGateInputSchema } from '../../../shared/mam/application-command'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { GitStateRepository } from '../state-store/git-state-repository'
import { advanceDeterministicNodes } from './deterministic-node-advancement'
import { publishMergeReadinessForApprovedTasks } from './merge-readiness-publisher'

export type CommandPublisher = Readonly<{
  executeAndPush(command: { command: SchedulerCommand; schedulerId: string }): unknown
}>

export function resolveApprovalGateAndPublishDelivery(input: {
  request: unknown
  repository: GitStateRepository
  commands: CommandPublisher
  schedulerId: string
  userId: string
  nextCommandId(): string
  now(): string
}): void {
  const request = MamResolveApprovalGateInputSchema.parse(input.request)
  input.commands.executeAndPush({
    command: {
      schemaVersion: '1.0.0',
      commandId: input.nextCommandId(),
      issuedAt: input.now(),
      workflowRunId: request.workflowRunId,
      actor: { kind: 'user', userId: input.userId },
      type: 'resolve_approval_gate',
      gateId: request.gateId,
      option: request.option
    },
    schedulerId: input.schedulerId
  })
  advanceDeterministicNodes({
    repository: input.repository,
    workflowRunId: request.workflowRunId,
    schedulerId: input.schedulerId,
    nextCommandId: input.nextCommandId,
    now: input.now
  })
  publishMergeReadinessForApprovedTasks({
    repository: input.repository,
    workflowRunId: request.workflowRunId,
    schedulerId: input.schedulerId,
    nextCommandId: input.nextCommandId,
    now: input.now
  })
}
