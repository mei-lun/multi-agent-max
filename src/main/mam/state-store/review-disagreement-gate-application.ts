import type { SchedulerEvent } from '../../../shared/mam/scheduler-protocol'
import type { TaskProjection, WorkflowRunProjection } from './git-state-projection'
import { GitEventApplicationError } from './git-event-application-error'

export function applyReviewDisagreementStatus(input: {
  event: Extract<SchedulerEvent, { type: 'approval_gate_resolved' }>
  tasks: Record<string, TaskProjection>
  aggregations: WorkflowRunProjection['reviewAggregations']
}): void {
  const aggregation = Object.values(input.aggregations).find(
    (candidate) => candidate.requiresHumanDecision && input.event.gateId === `gate.${candidate.id}`
  )
  if (!aggregation) return
  if (!isReviewStatus(input.event.option)) {
    throw new GitEventApplicationError(
      'invalid_review_resolution',
      'Review disagreement resolution has an invalid status'
    )
  }
  const task = input.tasks[aggregation.subject.taskId]
  if (!task) {
    throw new GitEventApplicationError(
      'task_not_assigned',
      'Review aggregation target Task is unavailable'
    )
  }
  input.tasks[aggregation.subject.taskId] = {
    ...task,
    status: input.event.option,
    lastEventId: input.event.eventId
  }
}

function isReviewStatus(option: string): option is 'approved' | 'changes_requested' | 'blocked' {
  return option === 'approved' || option === 'changes_requested' || option === 'blocked'
}
