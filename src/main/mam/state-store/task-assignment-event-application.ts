import type { SchedulerEvent } from '../../../shared/mam/scheduler-protocol'
import type { TaskProjection } from './git-state-projection'
import {
  failGitEventApplication as fail,
  requireProjectedTask,
  updateProjectedTask
} from './task-attempt-event-state'

type TaskAssignmentEvent = Extract<SchedulerEvent, { type: 'task_assigned' | 'task_reassigned' }>

export function applyTaskAssignmentEvent(input: {
  event: TaskAssignmentEvent
  tasks: Record<string, TaskProjection>
}): void {
  const { event, tasks } = input
  if (event.type === 'task_assigned') {
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
    return
  }
  const task = requireProjectedTask(tasks, event.taskId)
  if (
    task.roleProfileId !== event.previousRoleProfileId ||
    task.roleProfileVersion !== event.previousRoleProfileVersion
  ) {
    fail('assignment_changed', 'Role Assignment history does not match the reassignment event')
  }
  tasks[event.taskId] = updateProjectedTask(task, event, {
    roleProfileId: event.roleProfileId,
    roleProfileVersion: event.roleProfileVersion,
    assignedByUserId: event.assignedByUserId
  })
}
