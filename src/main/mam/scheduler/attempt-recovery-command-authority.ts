import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { SchedulerTaskContext } from './scheduler-command-authority'

type AttemptRecoveryCommand = Extract<SchedulerCommand, { type: 'recover_attempt' }>

export function assertAttemptRecoveryAuthority(input: {
  command: AttemptRecoveryCommand
  task: SchedulerTaskContext
  schedulerId: string
  reject(code: string, message: string): never
}): void {
  const { command, task, reject } = input
  if (
    command.actor.kind !== 'user' &&
    (command.actor.kind !== 'scheduler' || command.actor.schedulerId !== input.schedulerId)
  ) {
    reject('scheduler_authority_required', 'command requires the active Scheduler identity')
  }
  if (!task.knownAttemptIds.has(command.previousAttemptId)) {
    reject('attempt_not_found', 'recovery target does not belong to this task')
  }
  const active = task.activeAttemptIds.has(command.previousAttemptId)
  const reconciling = task.reconcilingAttemptIds?.has(command.previousAttemptId) ?? false
  if (command.directive.kind === 'needs_reconciliation' && !active) {
    reject('stale_attempt', 'only an active Attempt can require reconciliation')
  }
  if (command.directive.kind === 'start_new_attempt' && !active && !reconciling) {
    reject('stale_attempt', 'Attempt is not active or awaiting reconciliation')
  }
  if (
    reconciling &&
    command.directive.kind === 'start_new_attempt' &&
    command.actor.kind !== 'user'
  ) {
    reject('user_authority_required', 'only a user can confirm completed reconciliation')
  }
  if (
    command.directive.kind === 'start_new_attempt' &&
    task.knownAttemptIds.has(command.directive.newAttemptId)
  ) {
    reject('duplicate_attempt', 'recovery must create a new Attempt')
  }
}
