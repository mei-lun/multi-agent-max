import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { SchedulerKernelContext, SchedulerTaskContext } from './scheduler-kernel-context'

export function assertTaskResultReuseAuthority(input: {
  command: Extract<SchedulerCommand, { type: 'reuse_task_result' }>
  task: SchedulerTaskContext
  schedulerId: string
  reject(code: string, message: string): never
}): void {
  const { command, task, schedulerId, reject } = input
  if (command.actor.kind !== 'scheduler' || command.actor.schedulerId !== schedulerId) {
    reject('scheduler_authority_required', 'result reuse requires the active Scheduler')
  }
  if (!['waiting_dependencies', 'waiting_role_assignment'].includes(task.status)) {
    reject('task_result_reuse_not_allowed', 'Task already has authoritative progress')
  }
  if (task.knownAttemptIds.size > 0) {
    reject('task_result_reuse_not_allowed', 'Task already has Attempt history')
  }
  if (!task.allowedRoleProfileIds.has(command.roleProfileId)) {
    reject('role_not_allowed', 'Reused result does not match the fixed Workflow Role')
  }
  if (!task.roleCatalogVersions.get(command.roleProfileId)?.has(command.roleProfileVersion)) {
    reject('role_not_in_run_catalog', 'Reused result Role is outside the frozen Run catalog')
  }
}

export function assertNodeCompletionReuseAuthority(input: {
  command: Extract<SchedulerCommand, { type: 'reuse_node_completion' }>
  context: SchedulerKernelContext
  reject(code: string, message: string): never
}): void {
  const { command, context, reject } = input
  if (command.actor.kind !== 'scheduler' || command.actor.schedulerId !== context.schedulerId) {
    reject('scheduler_authority_required', 'node reuse requires the active Scheduler')
  }
  if (context.nodeStatuses?.get(command.nodeId) === 'passed') {
    reject('node_completion_reuse_not_allowed', 'Workflow node has already passed')
  }
}
