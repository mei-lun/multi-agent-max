import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { ReviewDecision, ReviewSubject } from '../../../shared/mam/domain/review'
import { materializeDynamicTaskPlan } from '../application/dynamic-task-plan-service'
import {
  assertReviewAggregationAuthority,
  assertReviewPanelAuthority
} from './review-command-authority'
import { SchedulerCommandRejectedError } from './scheduler-command-rejection'
import type { MergeQueueEntry } from '../../../shared/mam/domain/merge-queue'
import type { MergeConflictResolution } from '../../../shared/mam/domain/merge-conflict-task'
import {
  assertGlobalMergeQueueAuthority,
  assertMergeConflictResolutionAuthority,
  assertMergeReadyAuthority
} from './merge-queue-command-authority'
import { assertConditionCommandAuthority } from './condition-command-authority'
import { assertSystemNodeCommandAuthority } from './system-node-command-authority'
import { assertTaskAssignmentAuthority } from './task-assignment-command-authority'
import { assertAttemptRecoveryAuthority } from './attempt-recovery-command-authority'
import { assertActiveExecutorCommand } from './attempt-executor-command-authority'

export type AttemptBinding = Readonly<{
  roleInstanceId: string
  executorInvocationId: string
  effectiveConfigHash: string
}>

export type SchedulerTaskContext = Readonly<{
  workflowRunId: string
  taskId: string
  status:
    | 'waiting_dependencies'
    | 'waiting_role_assignment'
    | 'ready'
    | 'running'
    | 'submitted'
    | 'in_review'
    | 'changes_requested'
    | 'approved'
    | 'completed'
    | 'blocked'
    | 'cancelled'
    | 'needs_attention'
  assignedRoleProfileId?: string
  assignedRoleProfileVersion?: number
  activeAttemptIds: ReadonlySet<string>
  reconcilingAttemptIds?: ReadonlySet<string>
  knownAttemptIds: ReadonlySet<string>
  submittedAttemptIds: ReadonlySet<string>
  attemptBindings: ReadonlyMap<string, AttemptBinding>
  allowedRoleProfileIds: ReadonlySet<string>
  roleCatalogVersions: ReadonlyMap<string, ReadonlySet<number>>
  dynamicTaskPlanHash?: string
  reviewTarget?: ReviewSubject
  allowedReviewNodeIds?: ReadonlySet<string>
  reviewDecisions: ReadonlyMap<string, ReviewDecision>
  minimumReviewDecisions?: number
  reviewPanelId?: string
  mergeCandidate?: MergeQueueEntry
  mergeResolutionCandidate?: MergeConflictResolution
}>

export type SchedulerKernelContext = Readonly<{
  schedulerId: string
  runCancelled?: boolean
  hasActiveAttempts?: boolean
  task?: SchedulerTaskContext
  approvalGates?: ReadonlyMap<
    string,
    Readonly<{ status: 'pending' | 'resolved'; options: ReadonlySet<string> }>
  >
  resolvedConditionNodeIds?: ReadonlySet<string>
  nodeStatuses?: ReadonlyMap<string, string>
  completedSystemNodeIds?: ReadonlySet<string>
  validArtifactHashes: ReadonlySet<string>
  processedCommandIds: ReadonlySet<string>
  runBundle?: WorkflowRunBundle
  existingTaskIds?: ReadonlySet<string>
  mergeQueueEntries: ReadonlyMap<string, MergeQueueEntry>
  revision?: string
}>

export { SchedulerCommandRejectedError }

export function assertSchedulerCommandAuthority(
  command: SchedulerCommand,
  context: SchedulerKernelContext
): void {
  if (command.type === 'create_workflow_run') {
    return assertScheduler(command, context)
  }
  if (command.type === 'cancel_workflow_run') {
    assertUser(command)
    if (context.runCancelled) reject('run_already_cancelled', 'Workflow Run is already cancelled')
    if (context.hasActiveAttempts) {
      reject('active_attempts_present', 'Recover active Attempts before cancelling this Run')
    }
    return
  }
  if (context.runCancelled && command.type !== 'resolve_state_conflict') {
    reject('run_cancelled', 'Workflow Run is cancelled')
  }
  if (command.type === 'resolve_approval_gate') {
    assertUser(command)
    const gate = context.approvalGates?.get(command.gateId)
    if (!gate) reject('unknown_approval_gate', 'approval gate was not found')
    if (gate.status !== 'pending') reject('approval_gate_closed', 'approval gate is closed')
    if (!gate.options.has(command.option)) {
      reject('invalid_approval_option', 'approval option is not allowed')
    }
    return
  }
  if (command.type === 'resolve_condition') {
    assertConditionCommandAuthority({ command, context, reject })
    return
  }
  if (command.type === 'complete_system_node') {
    assertSystemNodeCommandAuthority({ command, context, reject })
    return
  }
  if (command.type === 'resolve_state_conflict') {
    return assertUser(command)
  }
  if (
    command.type === 'claim_merge_entry' ||
    command.type === 'record_merge_outcome' ||
    command.type === 'supersede_merge_entry'
  ) {
    return assertGlobalMergeQueueAuthority(command, context)
  }

  const task = requireTask(command, context)
  if (command.type === 'assign_task' || command.type === 'reassign_task') {
    assertTaskAssignmentAuthority({ command, task, reject })
    return
  }
  if (command.type === 'select_attempt') {
    assertUser(command)
    if (!task.knownAttemptIds.has(command.attemptId)) {
      reject('attempt_not_found', 'attempt does not belong to this task')
    }
    return
  }
  if (command.type === 'announce_execution') {
    assertScheduler(command, context)
    if (task.status === 'needs_attention') {
      reject('reconciliation_required', 'task requires user reconciliation before execution')
    }
    if (!task.assignedRoleProfileId) {
      reject('assignment_required', 'execution requires a user Role Assignment')
    }
    if (
      command.previousAttemptId &&
      (!task.knownAttemptIds.has(command.previousAttemptId) ||
        command.previousAttemptId === command.attemptId)
    ) {
      reject('attempt_lineage_mismatch', 'Previous Attempt does not belong to this Task')
    }
    return
  }
  if (command.type === 'start_attempt') {
    assertScheduler(command, context)
    if (task.status === 'needs_attention') {
      reject('reconciliation_required', 'task requires user reconciliation before execution')
    }
    if (!task.assignedRoleProfileId) {
      reject('assignment_required', 'attempt requires a user Role Assignment')
    }
    if (!task.knownAttemptIds.has(command.attemptId)) {
      reject('execution_notice_required', 'attempt requires an execution notice or recovery plan')
    }
    if (task.attemptBindings.has(command.attemptId)) {
      reject('duplicate_attempt_start', 'Attempt already has an Executor binding')
    }
    return
  }
  if (command.type === 'recover_attempt') {
    assertAttemptRecoveryAuthority({ command, task, schedulerId: context.schedulerId, reject })
    return
  }
  if (command.type === 'mark_merge_ready') {
    return assertMergeReadyAuthority(command, task, context)
  }
  if (command.type === 'record_merge_conflict_resolution') {
    return assertMergeConflictResolutionAuthority(command, task, context)
  }
  if (command.type === 'create_dynamic_tasks') {
    assertScheduler(command, context)
    if (task.status !== 'submitted') {
      reject('dynamic_source_not_submitted', 'Task Plan source Attempt is not submitted')
    }
    if (!task.submittedAttemptIds.has(command.attemptId)) {
      reject('dynamic_source_attempt_invalid', 'Task Plan source Attempt is not submitted')
    }
    if (task.dynamicTaskPlanHash) {
      reject('dynamic_tasks_already_created', 'Task Plan has already created Dynamic Tasks')
    }
    if (!context.runBundle) {
      reject('run_bundle_required', 'Dynamic Task creation requires the authoritative Run Bundle')
    }
    materializeDynamicTaskPlan({
      bundle: context.runBundle,
      sourceTaskId: command.taskId,
      sourceAttemptId: command.attemptId,
      plan: command.plan,
      planArtifact: command.planArtifact,
      ...(context.existingTaskIds ? { existingTaskIds: context.existingTaskIds } : {})
    })
    return
  }
  if (command.type === 'record_review_aggregation') {
    assertReviewAggregationAuthority(command, task, context.schedulerId)
    return
  }
  if (command.type === 'create_review_panel') {
    assertReviewPanelAuthority(command, task, context)
    return
  }

  assertExecutor(command, task)
  if (command.type === 'submit_attempt_result' || command.type === 'report_progress') {
    assertActiveExecutorCommand({ command, task, reject })
  }
  if (command.type === 'submit_attempt_result') {
    const system = command.result.system
    const binding = task.attemptBindings.get(command.attemptId)!
    if (
      system.workflowRunId !== command.workflowRunId ||
      system.taskId !== command.taskId ||
      system.attemptId !== command.attemptId ||
      system.roleInstanceId !== binding.roleInstanceId ||
      system.executorInvocationId !== binding.executorInvocationId ||
      system.effectiveConfigHash !== binding.effectiveConfigHash
    ) {
      reject('result_binding_mismatch', 'Attempt Result authority fields do not match the Attempt')
    }
    const invalidArtifact = command.result.artifacts.find(
      (artifact) => !context.validArtifactHashes.has(artifact.sha256)
    )
    if (invalidArtifact) {
      reject('invalid_artifact', 'Attempt Result references an unvalidated Artifact')
    }
  }
  if (command.type === 'record_review') {
    if (command.actor.kind !== 'executor') {
      reject('executor_authority_required', 'review requires an Executor actor')
    }
    if (!task.reviewTarget) {
      reject('review_target_required', 'Reviewer Task has no immutable Review subject')
    }
    if (
      command.review.workflowRunId !== command.workflowRunId ||
      command.review.reviewerTaskId !== command.taskId ||
      command.review.reviewerAttemptId !== command.attemptId ||
      command.review.reviewerRoleInstanceId !== command.actor.roleInstanceId ||
      JSON.stringify(command.review.subject) !== JSON.stringify(task.reviewTarget)
    ) {
      reject('review_binding_mismatch', 'review is not bound to the active Executor Attempt')
    }
  }
}

function requireTask(
  command: SchedulerCommand & { taskId: string },
  context: SchedulerKernelContext
): SchedulerTaskContext {
  const task = context.task
  if (!task || command.workflowRunId !== task.workflowRunId || command.taskId !== task.taskId) {
    reject('task_binding_mismatch', 'command targets another task')
  }
  return task
}

function assertUser(command: SchedulerCommand): void {
  if (command.actor.kind !== 'user') {
    reject('user_authority_required', 'only a user can issue this command')
  }
}

function assertScheduler(command: SchedulerCommand, context: SchedulerKernelContext): void {
  if (command.actor.kind !== 'scheduler' || command.actor.schedulerId !== context.schedulerId) {
    reject('scheduler_authority_required', 'command requires the active Scheduler identity')
  }
}

function assertExecutor(
  command: Extract<SchedulerCommand, { actor: { kind: 'executor' } }> | SchedulerCommand,
  task: SchedulerTaskContext
): void {
  if (command.actor.kind !== 'executor' || !('attemptId' in command)) {
    reject('executor_authority_required', 'command requires an Executor actor')
  }
  const binding = task.attemptBindings.get(command.attemptId)
  if (
    !binding ||
    command.actor.attemptId !== command.attemptId ||
    command.actor.roleInstanceId !== binding.roleInstanceId ||
    command.actor.executorInvocationId !== binding.executorInvocationId
  ) {
    reject('stale_attempt', 'Executor is not bound to this Attempt')
  }
}

function reject(code: string, message: string): never {
  throw new SchedulerCommandRejectedError(code, message)
}
