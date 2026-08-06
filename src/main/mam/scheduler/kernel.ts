import {
  EMPTY_SCHEDULER_REVISION,
  SchedulerCommandSchema,
  SchedulerEventSchema,
  type SchedulerCommand,
  type SchedulerEvent
} from '../../../shared/mam/scheduler-protocol'
import {
  assertSchedulerCommandAuthority,
  SchedulerCommandRejectedError,
  type SchedulerKernelContext,
  type SchedulerTaskContext
} from './scheduler-command-authority'
import { materializeDynamicTaskPlan } from '../application/dynamic-task-plan-service'
import { createReviewTasks } from '../review/review-fan-out-service'
import { createHumanAttentionEvent, isHumanAttentionCommand } from './human-attention-event-factory'

export { SchedulerCommandRejectedError }
export type { SchedulerKernelContext, SchedulerTaskContext }

const KERNEL_AUTHORITY = Symbol('mam.scheduler.kernel-authority')

export type KernelEventBatch = Readonly<{
  events: readonly SchedulerEvent[]
  [KERNEL_AUTHORITY]: true
}>

export class SchedulerKernel {
  execute(commandInput: unknown, context: SchedulerKernelContext): KernelEventBatch {
    const parsed = SchedulerCommandSchema.safeParse(commandInput)
    if (!parsed.success) {
      throw new SchedulerCommandRejectedError(
        'invalid_command',
        parsed.error.issues[0]?.message ?? 'invalid command'
      )
    }
    const command = parsed.data
    if (context.processedCommandIds.has(command.commandId)) {
      return this.authorize([])
    }
    assertSchedulerCommandAuthority(command, context)
    return this.authorize([SchedulerEventSchema.parse(this.createEvent(command, context))])
  }

  restorePendingBatch(eventsInput: readonly unknown[]): KernelEventBatch {
    return this.authorize(eventsInput.map((event) => SchedulerEventSchema.parse(event)))
  }

  private createEvent(command: SchedulerCommand, context: SchedulerKernelContext): unknown {
    const base = {
      schemaVersion: '1.0.0' as const,
      eventId: `${command.commandId}:event:1`,
      commandId: command.commandId,
      createdAt: command.issuedAt,
      workflowRunId: command.workflowRunId,
      schedulerId: context.schedulerId,
      parentRevision: context.revision ?? EMPTY_SCHEDULER_REVISION
    }
    if (isHumanAttentionCommand(command)) {
      return createHumanAttentionEvent(command, context, base)
    }
    switch (command.type) {
      case 'create_workflow_run':
        return {
          ...base,
          type: 'workflow_run_created',
          definitionId: command.definitionId,
          definitionVersion: command.definitionVersion,
          planHash: command.planHash,
          roleCatalogHash: command.roleCatalogHash
        }
      case 'cancel_workflow_run':
        return {
          ...base,
          type: 'workflow_run_cancelled',
          userId: command.actor.kind === 'user' ? command.actor.userId : '',
          reason: command.reason
        }
      case 'assign_task':
        return {
          ...base,
          type: 'task_assigned',
          taskId: command.taskId,
          roleProfileId: command.roleProfileId,
          roleProfileVersion: command.roleProfileVersion,
          assignedByUserId: command.actor.kind === 'user' ? command.actor.userId : ''
        }
      case 'reassign_task':
        return {
          ...base,
          type: 'task_reassigned',
          taskId: command.taskId,
          previousRoleProfileId: command.previousRoleProfileId,
          previousRoleProfileVersion: command.previousRoleProfileVersion,
          roleProfileId: command.roleProfileId,
          roleProfileVersion: command.roleProfileVersion,
          assignedByUserId: command.actor.kind === 'user' ? command.actor.userId : ''
        }
      case 'reuse_task_result': {
        return {
          ...base,
          type: 'task_result_reused',
          taskId: command.taskId,
          sourceWorkflowRunId: command.sourceWorkflowRunId,
          sourceTaskId: command.sourceTaskId,
          sourceAttemptId: command.sourceAttemptId,
          sourceEventId: command.sourceEventId,
          sourceNodeId: command.sourceNodeId,
          status: command.status,
          roleProfileId: command.roleProfileId,
          roleProfileVersion: command.roleProfileVersion,
          result: command.result
        }
      }
      case 'reuse_node_completion': {
        return {
          ...base,
          type: 'node_completion_reused',
          nodeId: command.nodeId,
          sourceWorkflowRunId: command.sourceWorkflowRunId,
          sourceNodeId: command.sourceNodeId,
          sourceEvidenceId: command.sourceEvidenceId
        }
      }
      case 'announce_execution':
        return {
          ...base,
          type: 'execution_announced',
          taskId: command.taskId,
          claimId: command.claimId,
          attemptId: command.attemptId,
          ...(command.previousAttemptId ? { previousAttemptId: command.previousAttemptId } : {}),
          executorInstanceId: command.executorInstanceId,
          concurrentAttemptIds: [...(context.task?.activeAttemptIds ?? [])]
        }
      case 'start_attempt':
        return {
          ...base,
          type: 'attempt_started',
          taskId: command.taskId,
          attemptId: command.attemptId,
          roleInstanceId: command.roleInstanceId,
          executorInvocationId: command.executorInvocationId,
          effectiveConfigSnapshotId: command.effectiveConfigSnapshotId,
          effectiveConfigHash: command.effectiveConfigHash
        }
      case 'recover_attempt':
        return {
          ...base,
          type: 'attempt_recovery_recorded',
          taskId: command.taskId,
          previousAttemptId: command.previousAttemptId,
          directive: command.directive,
          reason: command.reason,
          ...(command.actor.kind === 'user' ? { recoveredByUserId: command.actor.userId } : {})
        }
      case 'submit_attempt_result':
        return {
          ...base,
          type: 'attempt_result_submitted',
          taskId: command.taskId,
          attemptId: command.attemptId,
          result: command.result
        }
      case 'create_dynamic_tasks':
        return {
          ...base,
          type: 'dynamic_tasks_created',
          taskId: command.taskId,
          attemptId: command.attemptId,
          plan: command.plan,
          planArtifact: command.planArtifact,
          dynamicTasks: materializeDynamicTaskPlan({
            bundle: context.runBundle!,
            sourceTaskId: command.taskId,
            sourceAttemptId: command.attemptId,
            plan: command.plan,
            planArtifact: command.planArtifact,
            ...(context.existingTaskIds ? { existingTaskIds: context.existingTaskIds } : {})
          })
        }
      case 'record_review':
        return {
          ...base,
          type: 'review_recorded',
          taskId: command.taskId,
          attemptId: command.attemptId,
          review: command.review
        }
      case 'record_review_aggregation':
        return {
          ...base,
          type: 'review_aggregation_recorded',
          taskId: command.taskId,
          aggregation: command.aggregation
        }
      case 'create_review_panel':
        return {
          ...base,
          type: 'review_panel_created',
          taskId: command.taskId,
          reviewNodeId: command.reviewNodeId,
          subject: command.subject,
          reviewTasks: createReviewTasks({
            bundle: context.runBundle!,
            reviewNodeId: command.reviewNodeId,
            subject: command.subject,
            ...(context.existingTaskIds ? { existingTaskIds: context.existingTaskIds } : {})
          })
        }
      case 'select_attempt':
        return {
          ...base,
          type: 'attempt_selected',
          taskId: command.taskId,
          attemptId: command.attemptId,
          selectedByUserId: command.actor.kind === 'user' ? command.actor.userId : ''
        }
      case 'report_progress':
        return {
          ...base,
          type: 'progress_reported',
          taskId: command.taskId,
          attemptId: command.attemptId,
          message: command.message,
          ...(command.percent === undefined ? {} : { percent: command.percent })
        }
      case 'resolve_approval_gate':
        return {
          ...base,
          type: 'approval_gate_resolved',
          gateId: command.gateId,
          userId: command.actor.kind === 'user' ? command.actor.userId : '',
          option: command.option
        }
      case 'resolve_condition':
        return {
          ...base,
          type: 'condition_resolved',
          nodeId: command.nodeId,
          selectedBranch: command.selectedBranch
        }
      case 'complete_system_node':
        return { ...base, type: 'system_node_executed', execution: command.execution }
      case 'resolve_state_conflict':
        return {
          ...base,
          type: 'state_conflict_resolved',
          conflictId: command.conflictId,
          userId: command.actor.kind === 'user' ? command.actor.userId : '',
          resolution: command.resolution,
          rationale: command.rationale
        }
      case 'mark_merge_ready':
        return {
          ...base,
          type: 'merge_ready_recorded',
          taskId: command.taskId,
          entry: command.entry
        }
      case 'claim_merge_entry':
        return {
          ...base,
          type: 'merge_entry_claimed',
          entryId: command.entryId,
          claimedAt: command.claimedAt
        }
      case 'record_merge_outcome':
        return {
          ...base,
          type: 'merge_outcome_recorded',
          entryId: command.entryId,
          outcome: command.outcome
        }
      case 'record_merge_conflict_resolution':
        return {
          ...base,
          type: 'merge_conflict_resolution_recorded',
          taskId: command.taskId,
          attemptId: command.attemptId,
          resolution: command.resolution
        }
      case 'supersede_merge_entry':
        return {
          ...base,
          type: 'merge_entry_superseded',
          entryId: command.entryId,
          replacementCommit: command.replacementCommit,
          supersededAt: command.supersededAt
        }
    }
  }

  private authorize(events: readonly SchedulerEvent[]): KernelEventBatch {
    return Object.freeze({ events: Object.freeze([...events]), [KERNEL_AUTHORITY]: true as const })
  }
}

export function isKernelEventBatch(value: unknown): value is KernelEventBatch {
  return typeof value === 'object' && value !== null && KERNEL_AUTHORITY in value
}
