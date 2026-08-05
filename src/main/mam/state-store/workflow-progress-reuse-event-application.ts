import type { SchedulerEvent } from '../../../shared/mam/scheduler-protocol'
import type { AttemptProjection, TaskProjection } from './git-state-projection'
import { failGitEventApplication as fail } from './task-attempt-event-state'
import type { ReusedNodeCompletions } from './workflow-progress-reuse-projection'

export function applyTaskResultReuse(input: {
  event: Extract<SchedulerEvent, { type: 'task_result_reused' }>
  tasks: Record<string, TaskProjection>
  attempts: Record<string, AttemptProjection>
}): void {
  const { event, tasks, attempts } = input
  if (tasks[event.taskId] || attempts[event.sourceAttemptId]) {
    fail('duplicate_reused_result', 'Task or reused Attempt already has progress')
  }
  const reusedFrom = {
    workflowRunId: event.sourceWorkflowRunId,
    taskId: event.sourceTaskId,
    attemptId: event.sourceAttemptId,
    nodeId: event.sourceNodeId
  }
  attempts[event.sourceAttemptId] = {
    taskId: event.taskId,
    status: 'submitted',
    roleInstanceId: event.result.system.roleInstanceId,
    executorInvocationId: event.result.system.executorInvocationId,
    effectiveConfigHash: event.result.system.effectiveConfigHash,
    result: event.result,
    reusedFrom,
    lastEventId: event.eventId
  }
  tasks[event.taskId] = {
    status: event.status,
    roleProfileId: event.roleProfileId,
    roleProfileVersion: event.roleProfileVersion,
    assignedByUserId: 'scheduler.reuse',
    activeAttemptIds: [],
    knownAttemptIds: [event.sourceAttemptId],
    selectedAttemptId: event.sourceAttemptId,
    reviewIds: [],
    executionWarnings: [],
    ...(event.result.system.submittedCommit
      ? { submittedCommit: event.result.system.submittedCommit }
      : {}),
    reusedFrom,
    lastEventId: event.eventId
  }
}

export function applyNodeCompletionReuse(input: {
  event: Extract<SchedulerEvent, { type: 'node_completion_reused' }>
  completions: Record<string, ReusedNodeCompletions[string]>
}): void {
  const { event, completions } = input
  if (completions[event.nodeId]) {
    fail('duplicate_reused_node', 'Workflow node completion was already reused')
  }
  completions[event.nodeId] = {
    sourceWorkflowRunId: event.sourceWorkflowRunId,
    sourceNodeId: event.sourceNodeId,
    sourceEvidenceId: event.sourceEvidenceId,
    reusedAt: event.createdAt
  }
}
