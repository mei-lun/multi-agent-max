import type { SchedulerEvent } from '../../../shared/mam/scheduler-protocol'
import type { WorkflowRunProjection } from './git-state-projection'
import { applyDynamicTaskEvent } from './dynamic-task-event-application'
import {
  applyReviewRecordedEvent,
  invalidateReviewsForNewAttempt
} from './review-event-application'
import { applyReviewAggregationEvent } from './review-aggregation-event-application'
import { applyReviewDisagreementStatus } from './review-disagreement-gate-application'
import { applyReviewPanelEvent } from './review-panel-event-application'
import { applyMergeQueueEvent } from './merge-queue-event-application'
import { applyAttemptResultSubmitted } from './attempt-result-event-application'
import {
  failGitEventApplication as fail,
  requireProjectedAttempt as requireAttempt,
  requireProjectedTask as requireTask,
  uniqueIds as unique,
  updateProjectedTask as updateTask
} from './task-attempt-event-state'

export function applyEvent(
  projection: WorkflowRunProjection,
  event: SchedulerEvent
): WorkflowRunProjection {
  const tasks = { ...projection.tasks }
  const attempts = { ...projection.attempts }
  const dynamicTaskPlans = { ...projection.dynamicTaskPlans }
  const dynamicTasks = { ...projection.dynamicTasks }
  const reviews = { ...projection.reviews }
  const reviewAggregations = { ...projection.reviewAggregations }
  const reviewPanels = { ...projection.reviewPanels }
  const reviewTasks = { ...projection.reviewTasks }
  const reviewValidity = { ...projection.reviewValidity }
  const mergeQueueEntries = { ...projection.mergeQueueEntries }
  const mergeConflictTasks = { ...projection.mergeConflictTasks }
  const mergeConflictResolutions = { ...projection.mergeConflictResolutions }
  const gates = { ...projection.resolvedApprovalGates }
  const conditions = { ...projection.resolvedConditions }
  const systemNodes = { ...projection.systemNodeExecutions }
  const conflictResolutions = { ...projection.conflictResolutions }
  switch (event.type) {
    case 'workflow_run_created':
      if (projection.workflow) fail('invalid_transition', 'workflow run already exists')
      return {
        ...projection,
        workflow: {
          definitionId: event.definitionId,
          definitionVersion: event.definitionVersion,
          planHash: event.planHash,
          roleCatalogHash: event.roleCatalogHash
        }
      }
    case 'task_assigned':
      if (tasks[event.taskId]) fail('invalid_transition', 'task already assigned')
      tasks[event.taskId] = {
        status: 'ready',
        roleProfileId: event.roleProfileId,
        roleProfileVersion: event.roleProfileVersion,
        assignedByUserId: event.assignedByUserId,
        activeAttemptIds: [],
        knownAttemptIds: [],
        reviewIds: [],
        executionWarnings: [],
        lastEventId: event.eventId
      }
      break
    case 'execution_announced': {
      const task = requireTask(tasks, event.taskId)
      const { reviewPanelId: _reviewPanelId, ...taskWithoutReviewPanel } = task
      const existing = attempts[event.attemptId]
      if (existing && existing.status !== 'recovery_planned') {
        fail('duplicate_attempt', 'attempt already exists')
      }
      attempts[event.attemptId] = {
        ...existing,
        taskId: event.taskId,
        ...(event.previousAttemptId ? { previousAttemptId: event.previousAttemptId } : {}),
        status: 'announced',
        executorInstanceId: event.executorInstanceId,
        lastEventId: event.eventId
      }
      tasks[event.taskId] = updateTask(taskWithoutReviewPanel, event, {
        status: 'running',
        activeAttemptIds: unique([...task.activeAttemptIds, event.attemptId]),
        knownAttemptIds: unique([...task.knownAttemptIds, event.attemptId]),
        executionWarnings:
          event.concurrentAttemptIds.length === 0
            ? task.executionWarnings
            : [
                ...task.executionWarnings,
                {
                  attemptId: event.attemptId,
                  concurrentAttemptIds: event.concurrentAttemptIds,
                  eventId: event.eventId
                }
              ]
      })
      invalidateReviewsForNewAttempt({
        taskId: event.taskId,
        attemptId: event.attemptId,
        reviews,
        validity: reviewValidity
      })
      break
    }
    case 'attempt_recovery_recorded': {
      const task = requireTask(tasks, event.taskId)
      const previous = requireAttempt(attempts, event.previousAttemptId, event.taskId)
      const activeAttemptIds = task.activeAttemptIds.filter(
        (attemptId) => attemptId !== event.previousAttemptId
      )
      if (event.directive.kind === 'needs_reconciliation') {
        attempts[event.previousAttemptId] = {
          ...previous,
          status: 'needs_reconciliation',
          lastEventId: event.eventId
        }
        tasks[event.taskId] = updateTask(task, event, {
          status: 'needs_attention',
          activeAttemptIds
        })
        break
      }
      if (attempts[event.directive.newAttemptId]) {
        fail('duplicate_attempt', 'recovery Attempt already exists')
      }
      attempts[event.previousAttemptId] = {
        ...previous,
        status: 'blocked',
        lastEventId: event.eventId
      }
      attempts[event.directive.newAttemptId] = {
        taskId: event.taskId,
        previousAttemptId: event.previousAttemptId,
        status: 'recovery_planned',
        lastEventId: event.eventId
      }
      tasks[event.taskId] = updateTask(task, event, {
        status: 'ready',
        activeAttemptIds,
        knownAttemptIds: unique([...task.knownAttemptIds, event.directive.newAttemptId])
      })
      break
    }
    case 'attempt_started': {
      const task = requireTask(tasks, event.taskId)
      const attempt = attempts[event.attemptId]
      if (!attempt || (attempt.status !== 'announced' && attempt.status !== 'recovery_planned')) {
        fail('invalid_transition', 'Attempt is not ready to start')
      }
      attempts[event.attemptId] = {
        ...attempt,
        taskId: event.taskId,
        status: 'running',
        roleInstanceId: event.roleInstanceId,
        executorInvocationId: event.executorInvocationId,
        effectiveConfigSnapshotId: event.effectiveConfigSnapshotId,
        effectiveConfigHash: event.effectiveConfigHash,
        lastEventId: event.eventId
      }
      tasks[event.taskId] = updateTask(task, event, {
        status: 'running',
        activeAttemptIds: unique([...task.activeAttemptIds, event.attemptId]),
        knownAttemptIds: unique([...task.knownAttemptIds, event.attemptId])
      })
      break
    }
    case 'attempt_result_submitted': {
      applyAttemptResultSubmitted({ event, tasks, attempts, mergeQueueEntries })
      break
    }
    case 'dynamic_tasks_created': {
      applyDynamicTaskEvent({
        event,
        tasks,
        attempts,
        plans: dynamicTaskPlans,
        definitions: dynamicTasks
      })
      break
    }
    case 'review_recorded': {
      applyReviewRecordedEvent({
        event,
        tasks,
        attempts,
        reviews,
        validity: reviewValidity
      })
      break
    }
    case 'review_aggregation_recorded': {
      applyReviewAggregationEvent({
        event,
        tasks,
        reviews,
        reviewValidity,
        aggregations: reviewAggregations
      })
      break
    }
    case 'review_panel_created': {
      applyReviewPanelEvent({
        event,
        tasks,
        attempts,
        panels: reviewPanels,
        reviewTasks
      })
      break
    }
    case 'attempt_selected': {
      const task = requireTask(tasks, event.taskId)
      requireAttempt(attempts, event.attemptId, event.taskId)
      tasks[event.taskId] = updateTask(task, event, { selectedAttemptId: event.attemptId })
      break
    }
    case 'progress_reported': {
      const task = requireTask(tasks, event.taskId)
      requireAttempt(attempts, event.attemptId, event.taskId)
      tasks[event.taskId] = updateTask(task, event, { status: 'running' })
      break
    }
    case 'approval_gate_resolved':
      if (gates[event.gateId]) fail('invalid_transition', 'approval gate already resolved')
      gates[event.gateId] = {
        option: event.option,
        userId: event.userId,
        commandId: event.commandId,
        resolvedAt: event.createdAt
      }
      applyReviewDisagreementStatus({ event, tasks, aggregations: reviewAggregations })
      break
    case 'condition_resolved':
      if (conditions[event.nodeId]) fail('invalid_transition', 'condition already resolved')
      conditions[event.nodeId] = {
        selectedBranch: event.selectedBranch,
        commandId: event.commandId,
        resolvedAt: event.createdAt
      }
      break
    case 'system_node_executed':
      if (systemNodes[event.execution.nodeId]) fail('invalid_transition', 'system node already ran')
      systemNodes[event.execution.nodeId] = event.execution
      break
    case 'state_conflict_resolved':
      if (conflictResolutions[event.conflictId]) {
        fail('invalid_transition', 'state conflict already resolved')
      }
      conflictResolutions[event.conflictId] = {
        resolution: event.resolution,
        rationale: event.rationale,
        userId: event.userId
      }
      break
    case 'merge_ready_recorded':
    case 'merge_entry_claimed':
    case 'merge_outcome_recorded':
    case 'merge_entry_superseded': {
      applyMergeQueueEvent({
        event,
        tasks,
        entries: mergeQueueEntries,
        conflictTasks: mergeConflictTasks,
        conflictResolutions: mergeConflictResolutions,
        attempts
      })
      break
    }
    case 'merge_conflict_resolution_recorded': {
      applyMergeQueueEvent({
        event,
        tasks,
        entries: mergeQueueEntries,
        conflictTasks: mergeConflictTasks,
        conflictResolutions: mergeConflictResolutions,
        attempts
      })
      break
    }
  }
  return {
    ...projection,
    tasks,
    attempts,
    dynamicTaskPlans,
    dynamicTasks,
    reviews,
    reviewAggregations,
    reviewPanels,
    reviewTasks,
    reviewValidity,
    mergeQueueEntries,
    mergeConflictTasks,
    mergeConflictResolutions,
    resolvedApprovalGates: gates,
    resolvedConditions: conditions,
    systemNodeExecutions: systemNodes,
    conflictResolutions
  }
}
