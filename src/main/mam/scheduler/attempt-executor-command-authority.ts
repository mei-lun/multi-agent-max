import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { SchedulerTaskContext } from './scheduler-command-authority'

type ActiveExecutorCommand = Extract<
  SchedulerCommand,
  { type: 'submit_attempt_result' | 'report_progress' }
>

export function assertActiveExecutorCommand(input: {
  command: ActiveExecutorCommand
  task: SchedulerTaskContext
  reject(code: string, message: string): never
}): void {
  if (!input.task.activeAttemptIds.has(input.command.attemptId)) {
    input.reject('stale_attempt', 'Executor Attempt is no longer active')
  }
  if (input.task.status === 'needs_attention') {
    input.reject(
      'reconciliation_required',
      'Task requires reconciliation before accepting Executor progress or results'
    )
  }
}
