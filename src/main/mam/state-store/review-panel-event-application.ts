import type { ReviewSubject, ReviewTaskDefinition } from '../../../shared/mam/domain/review'
import type { SchedulerEvent } from '../../../shared/mam/scheduler-protocol'
import type { AttemptProjection, TaskProjection } from './git-state-projection'

type ReviewPanelProjection = Readonly<{
  reviewNodeId: string
  subject: ReviewSubject
  reviewTaskIds: readonly string[]
}>

export class ReviewPanelEventError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ReviewPanelEventError'
  }
}

export function applyReviewPanelEvent(input: {
  event: Extract<SchedulerEvent, { type: 'review_panel_created' }>
  tasks: Record<string, TaskProjection>
  attempts: Readonly<Record<string, AttemptProjection>>
  panels: Record<string, ReviewPanelProjection>
  reviewTasks: Record<string, ReviewTaskDefinition>
}): void {
  const { event, tasks, attempts, panels, reviewTasks } = input
  const targetTask = tasks[event.taskId]
  const targetAttempt = attempts[event.subject.attemptId]
  if (
    !targetTask ||
    !targetAttempt ||
    targetAttempt.taskId !== event.taskId ||
    targetAttempt.status !== 'submitted' ||
    event.subject.taskId !== event.taskId ||
    (targetTask.selectedAttemptId ?? targetTask.knownAttemptIds.at(-1)) !== event.subject.attemptId
  ) {
    fail('review_binding_mismatch', 'Review panel subject is not the latest submitted Attempt')
  }
  const panelId = `${event.reviewNodeId}.${event.subject.attemptId}`
  if (panels[panelId] || targetTask.reviewPanelId) {
    fail('review_panel_already_created', 'Review panel already exists')
  }
  for (const definition of event.reviewTasks) {
    if (
      reviewTasks[definition.id] ||
      tasks[definition.id] ||
      definition.workflowRunId !== event.workflowRunId ||
      definition.reviewNodeId !== event.reviewNodeId ||
      JSON.stringify(definition.subject) !== JSON.stringify(event.subject)
    ) {
      fail('review_task_event_mismatch', 'Reviewer Task has invalid identity or lineage')
    }
    reviewTasks[definition.id] = definition
  }
  panels[panelId] = {
    reviewNodeId: event.reviewNodeId,
    subject: event.subject,
    reviewTaskIds: event.reviewTasks.map((task) => task.id)
  }
  tasks[event.taskId] = {
    ...targetTask,
    status: 'in_review',
    reviewPanelId: panelId,
    lastEventId: event.eventId
  }
}

function fail(code: string, message: string): never {
  throw new ReviewPanelEventError(code, message)
}
