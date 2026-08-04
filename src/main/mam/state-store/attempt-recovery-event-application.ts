import type { SchedulerEvent } from '../../../shared/mam/scheduler-protocol'
import type { AttemptProjection, TaskProjection } from './git-state-projection'
import { blockUnconsumedRecoveryPlans } from './attempt-recovery-plan-state'
import {
  failGitEventApplication as fail,
  requireProjectedAttempt,
  requireProjectedTask,
  uniqueIds,
  updateProjectedTask
} from './task-attempt-event-state'

export function applyAttemptRecoveryEvent(input: {
  event: Extract<SchedulerEvent, { type: 'attempt_recovery_recorded' }>
  tasks: Record<string, TaskProjection>
  attempts: Record<string, AttemptProjection>
}): void {
  const { event, tasks, attempts } = input
  const task = requireProjectedTask(tasks, event.taskId)
  const previous = requireProjectedAttempt(attempts, event.previousAttemptId, event.taskId)
  const activeAttemptIds = task.activeAttemptIds.filter(
    (attemptId) => attemptId !== event.previousAttemptId
  )
  if (event.directive.kind === 'needs_reconciliation') {
    if (previous.status !== 'announced' && previous.status !== 'running') {
      fail('stale_attempt', 'Only an active Attempt can require reconciliation')
    }
    attempts[event.previousAttemptId] = {
      ...previous,
      status: 'needs_reconciliation',
      lastEventId: event.eventId
    }
    tasks[event.taskId] = updateProjectedTask(task, event, {
      status: 'needs_attention',
      activeAttemptIds
    })
    return
  }
  if (
    previous.status !== 'announced' &&
    previous.status !== 'running' &&
    previous.status !== 'needs_reconciliation'
  ) {
    fail('stale_attempt', 'Attempt cannot create a replacement in its current state')
  }
  if (attempts[event.directive.newAttemptId]) {
    fail('duplicate_attempt', 'recovery Attempt already exists')
  }
  blockUnconsumedRecoveryPlans({ task, attempts, eventId: event.eventId })
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
  const hasUnresolvedReconciliation = task.knownAttemptIds.some(
    (attemptId) =>
      attemptId !== event.previousAttemptId &&
      attempts[attemptId]?.status === 'needs_reconciliation'
  )
  tasks[event.taskId] = updateProjectedTask(task, event, {
    status: hasUnresolvedReconciliation
      ? 'needs_attention'
      : activeAttemptIds.length > 0
        ? 'running'
        : 'ready',
    activeAttemptIds,
    knownAttemptIds: uniqueIds([...task.knownAttemptIds, event.directive.newAttemptId])
  })
}
