import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { SchedulerTaskContext } from './scheduler-command-authority'

type TaskAssignmentCommand = Extract<SchedulerCommand, { type: 'assign_task' | 'reassign_task' }>

export function assertTaskAssignmentAuthority(input: {
  command: TaskAssignmentCommand
  task: SchedulerTaskContext
  reject(code: string, message: string): never
}): void {
  const { command, task, reject } = input
  if (command.actor.kind !== 'user') {
    reject('user_authority_required', 'only a user can issue this command')
  }
  if (command.type === 'assign_task') {
    if (task.status !== 'waiting_role_assignment') {
      reject('invalid_transition', 'only an unassigned task can receive a Role Assignment')
    }
    assertTargetRoleAllowed(command, task, reject)
    return
  }
  if (task.status !== 'ready' && task.status !== 'changes_requested') {
    reject('invalid_transition', 'Role can change only before the next Attempt starts')
  }
  if (task.activeAttemptIds.size > 0) {
    reject('active_attempt_reassignment_forbidden', 'recover active Attempts before changing Role')
  }
  if (
    task.assignedRoleProfileId !== command.previousRoleProfileId ||
    task.assignedRoleProfileVersion !== command.previousRoleProfileVersion
  ) {
    reject('assignment_changed', 'Role Assignment changed before this command was applied')
  }
  if (
    command.roleProfileId === command.previousRoleProfileId &&
    command.roleProfileVersion === command.previousRoleProfileVersion
  ) {
    reject('assignment_unchanged', 'select a different Role version')
  }
  assertTargetRoleAllowed(command, task, reject)
}

function assertTargetRoleAllowed(
  command: TaskAssignmentCommand,
  task: SchedulerTaskContext,
  reject: (code: string, message: string) => never
): void {
  if (
    task.allowedRoleProfileIds.size > 0 &&
    !task.allowedRoleProfileIds.has(command.roleProfileId)
  ) {
    reject('role_not_allowed', 'Role is outside the Task allowlist')
  }
  if (!task.roleCatalogVersions.get(command.roleProfileId)?.has(command.roleProfileVersion)) {
    reject('role_not_in_run_catalog', 'Role version is outside the frozen Run catalog')
  }
}
