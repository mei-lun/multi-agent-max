import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import { boundedReviewStatus } from '../review/review-revision-limit'
import type { SchedulerKernelContext } from './scheduler-kernel-context'

type HumanAttentionCommand = Extract<
  SchedulerCommand,
  {
    type:
      | 'request_human_input'
      | 'answer_human_questions'
      | 'submit_human_understanding'
      | 'confirm_human_understanding'
      | 'revise_human_understanding'
      | 'resolve_human_review'
  }
>

type EventBase = Readonly<{
  schemaVersion: '1.0.0'
  eventId: string
  commandId: string
  createdAt: string
  workflowRunId: string
  schedulerId: string
  parentRevision: string
}>

const HUMAN_COMMANDS = new Set<HumanAttentionCommand['type']>([
  'request_human_input',
  'answer_human_questions',
  'submit_human_understanding',
  'confirm_human_understanding',
  'revise_human_understanding',
  'resolve_human_review'
])

export function isHumanAttentionCommand(
  command: SchedulerCommand
): command is HumanAttentionCommand {
  return HUMAN_COMMANDS.has(command.type as HumanAttentionCommand['type'])
}

export function createHumanAttentionEvent(
  command: HumanAttentionCommand,
  context: SchedulerKernelContext,
  base: EventBase
): unknown {
  if (command.type === 'request_human_input') {
    return {
      ...base,
      type: 'human_input_requested',
      taskId: command.taskId,
      attemptId: command.attemptId,
      interactionId: command.interactionId,
      roleProfileId: context.task!.assignedRoleProfileId!,
      roleProfileVersion: context.task!.assignedRoleProfileVersion!,
      roleInstanceId: command.actor.kind === 'executor' ? command.actor.roleInstanceId : '',
      executorInvocationId:
        command.actor.kind === 'executor' ? command.actor.executorInvocationId : '',
      scope: command.scope,
      kind: command.kind,
      batch: command.batch
    }
  }
  if (command.type === 'answer_human_questions') {
    return {
      ...base,
      type: 'human_questions_answered',
      taskId: command.taskId,
      interactionId: command.interactionId,
      batchId: command.batchId,
      answers: command.answers,
      answeredByUserId: command.actor.kind === 'user' ? command.actor.userId : ''
    }
  }
  if (command.type === 'submit_human_understanding') {
    return {
      ...base,
      type: 'human_understanding_submitted',
      taskId: command.taskId,
      attemptId: command.attemptId,
      interactionId: command.interactionId,
      summary: command.summary,
      roleInstanceId: command.actor.kind === 'executor' ? command.actor.roleInstanceId : '',
      executorInvocationId:
        command.actor.kind === 'executor' ? command.actor.executorInvocationId : ''
    }
  }
  if (command.type === 'confirm_human_understanding') {
    return {
      ...base,
      type: 'human_understanding_confirmed',
      taskId: command.taskId,
      interactionId: command.interactionId,
      confirmedByUserId: command.actor.kind === 'user' ? command.actor.userId : ''
    }
  }
  if (command.type === 'revise_human_understanding') {
    return {
      ...base,
      type: 'human_understanding_revision_requested',
      taskId: command.taskId,
      interactionId: command.interactionId,
      feedback: command.feedback,
      requestedByUserId: command.actor.kind === 'user' ? command.actor.userId : ''
    }
  }
  const gate = context.humanReviewGates!.get(command.gateNodeId)!
  const status = boundedReviewStatus({
    status: command.status,
    attemptCount: gate.attemptCount,
    maxRevisionAttempts: gate.maxRevisionAttempts
  })
  return {
    ...base,
    type: 'human_review_resolved',
    taskId: command.taskId,
    decision: {
      schemaVersion: '1.0.0',
      id: `human-review.${command.commandId}`,
      workflowRunId: command.workflowRunId,
      gateNodeId: command.gateNodeId,
      revisionTargetNodeId: gate.revisionTargetNodeId,
      revisionTargetTaskId: gate.revisionTargetTaskId,
      subject: command.subject,
      status,
      ...(command.feedback?.trim() ? { feedback: command.feedback.trim() } : {}),
      decidedByUserId: command.actor.kind === 'user' ? command.actor.userId : '',
      createdAt: command.issuedAt
    }
  }
}
