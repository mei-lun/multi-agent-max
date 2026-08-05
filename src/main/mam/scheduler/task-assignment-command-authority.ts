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
  reject('workflow_role_binding_fixed', 'Workflow node Roles cannot be reassigned during a Run')
}

function assertTargetRoleAllowed(
  command: TaskAssignmentCommand,
  task: SchedulerTaskContext,
  reject: (code: string, message: string) => never
): void {
  if (task.allowedRoleProfileIds.size !== 1) {
    reject('fixed_role_required', 'Task must have exactly one Workflow Role')
  }
  if (!task.allowedRoleProfileIds.has(command.roleProfileId)) {
    reject('role_not_allowed', 'Role does not match the fixed Workflow Role')
  }
  if (!task.roleCatalogVersions.get(command.roleProfileId)?.has(command.roleProfileVersion)) {
    reject('role_not_in_run_catalog', 'Role version is outside the frozen Run catalog')
  }
}
