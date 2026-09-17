import type {
  MamClaimTaskInput,
  MamForceTakeoverTaskInput,
  MamReleaseTaskClaimInput
} from '../../../shared/mam/application-command'
import {
  MamClaimTaskInputSchema,
  MamForceTakeoverTaskInputSchema,
  MamReleaseTaskClaimInputSchema
} from '../../../shared/mam/application-command'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { MamUiSnapshot } from '../../../shared/mam/ui-projection'

type TaskClaimPublisher = Readonly<{
  executeAndPush(input: { command: SchedulerCommand; schedulerId: string }): unknown
}>

type TaskClaimCommandInput = Readonly<{
  schedulerId: string
  userId: string
  claimantInstanceId: string
  commandId: string
  claimId?: string
  issuedAt: string
  publisher: TaskClaimPublisher
}>

export function publishTaskClaim(
  input: TaskClaimCommandInput & Readonly<{ request: MamClaimTaskInput; claimId: string }>
): void {
  input.publisher.executeAndPush({
    command: {
      ...envelope(input.request, input.commandId, input.issuedAt),
      actor: { kind: 'scheduler', schedulerId: input.schedulerId },
      type: 'claim_task',
      claimId: input.claimId,
      claimantInstanceId: input.claimantInstanceId
    },
    schedulerId: input.schedulerId
  })
}

export function publishTaskClaimRelease(
  input: TaskClaimCommandInput & Readonly<{ request: MamReleaseTaskClaimInput }>
): void {
  input.publisher.executeAndPush({
    command: {
      ...envelope(input.request, input.commandId, input.issuedAt),
      actor: { kind: 'user', userId: input.userId },
      type: 'release_task_claim',
      claimId: input.request.claimId,
      generation: input.request.generation
    },
    schedulerId: input.schedulerId
  })
}

export function publishTaskClaimTakeover(
  input: TaskClaimCommandInput &
    Readonly<{ request: MamForceTakeoverTaskInput; newClaimId: string }>
): void {
  input.publisher.executeAndPush({
    command: {
      ...envelope(input.request, input.commandId, input.issuedAt),
      actor: { kind: 'user', userId: input.userId },
      type: 'force_takeover_task',
      previousClaimId: input.request.previousClaimId,
      expectedGeneration: input.request.expectedGeneration,
      newClaimId: input.newClaimId,
      claimantInstanceId: input.claimantInstanceId,
      reason: input.request.reason
    },
    schedulerId: input.schedulerId
  })
}

function envelope(
  request: Readonly<{ workflowRunId: string; taskId: string }>,
  commandId: string,
  issuedAt: string
) {
  return {
    schemaVersion: '1.0.0' as const,
    commandId,
    issuedAt,
    workflowRunId: request.workflowRunId,
    taskId: request.taskId
  }
}

export function executeTaskClaimUiCommand(input: {
  action: 'claim' | 'release' | 'takeover'
  request: unknown
  userId: string
  schedulerId: string
  claimantInstanceId: string
  nextId(kind: 'command' | 'claim'): string
  issuedAt: string
  publisher: TaskClaimPublisher
  onStateChanged(): void
  getSnapshot(): MamUiSnapshot
}): MamUiSnapshot {
  const common = {
    userId: input.userId,
    schedulerId: input.schedulerId,
    claimantInstanceId: input.claimantInstanceId,
    commandId: input.nextId('command'),
    issuedAt: input.issuedAt,
    publisher: input.publisher
  }
  if (input.action === 'claim') {
    publishTaskClaim({
      ...common,
      request: MamClaimTaskInputSchema.parse(input.request),
      claimId: input.nextId('claim')
    })
  } else if (input.action === 'release') {
    publishTaskClaimRelease({
      ...common,
      request: MamReleaseTaskClaimInputSchema.parse(input.request)
    })
  } else {
    publishTaskClaimTakeover({
      ...common,
      request: MamForceTakeoverTaskInputSchema.parse(input.request),
      newClaimId: input.nextId('claim')
    })
  }
  input.onStateChanged()
  return input.getSnapshot()
}
