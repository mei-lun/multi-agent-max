import type { SchedulerEvent } from '../../../shared/mam/scheduler-protocol'
import type { DynamicTaskDefinition, TaskPlan } from '../../../shared/mam/domain/task-plan'
import type { ArtifactVersion } from '../../../shared/mam/domain/artifact'
import type { AttemptProjection, TaskProjection } from './git-state-projection'
import { assertDynamicTaskEvent } from './dynamic-task-event-validator'

type DynamicPlanProjection = Readonly<{
  plan: TaskPlan
  planArtifact: ArtifactVersion
  dynamicTaskIds: readonly string[]
}>

export function applyDynamicTaskEvent(input: {
  event: Extract<SchedulerEvent, { type: 'dynamic_tasks_created' }>
  tasks: Record<string, TaskProjection>
  attempts: Readonly<Record<string, AttemptProjection>>
  plans: Record<string, DynamicPlanProjection>
  definitions: Record<string, DynamicTaskDefinition>
}): void {
  const { event, tasks, attempts, plans, definitions } = input
  assertDynamicTaskEvent(event)
  const task = tasks[event.taskId]
  const attempt = attempts[event.attemptId]
  if (!task || !attempt || attempt.taskId !== event.taskId) {
    fail('dynamic_source_missing', 'Dynamic Task source is unavailable')
  }
  if (task.status !== 'submitted' || attempt.status !== 'submitted') {
    fail('dynamic_source_not_submitted', 'Dynamic Tasks require a submitted source Attempt')
  }
  if (task.dynamicTaskPlanHash || plans[event.plan.id]) {
    fail('dynamic_tasks_already_created', 'Task Plan has already created Dynamic Tasks')
  }
  for (const definition of event.dynamicTasks) {
    if (definitions[definition.id] || tasks[definition.id]) {
      fail('duplicate_dynamic_task', 'Dynamic Task already exists')
    }
    definitions[definition.id] = definition
  }
  plans[event.plan.id] = {
    plan: event.plan,
    planArtifact: event.planArtifact,
    dynamicTaskIds: event.dynamicTasks.map((definition) => definition.id)
  }
  tasks[event.taskId] = {
    ...task,
    dynamicTaskPlanHash: event.dynamicTasks[0]!.taskPlanHash,
    lastEventId: event.eventId
  }
}

function fail(code: string, message: string): never {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  throw error
}
