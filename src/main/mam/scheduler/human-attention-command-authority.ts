import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { SchedulerTaskContext } from './scheduler-kernel-context'

type HumanAttentionCommand = Extract<
  SchedulerCommand,
  {
    type:
      | 'request_human_input'
      | 'answer_human_questions'
      | 'submit_human_understanding'
      | 'confirm_human_understanding'
      | 'revise_human_understanding'
  }
>

export function assertHumanAttentionAuthority(input: {
  command: HumanAttentionCommand
  task: SchedulerTaskContext
  assertUser(command: SchedulerCommand): void
  assertExecutor(command: SchedulerCommand, task: SchedulerTaskContext): void
  reject(code: string, message: string): never
}): void {
  const { command, task, reject } = input
  const item = task.openHumanAttention
  if (command.type === 'request_human_input') {
    input.assertExecutor(command, task)
    if (!task.activeAttemptIds.has(command.attemptId)) {
      reject('stale_attempt', 'Only an active Attempt can ask the user')
    }
    if (!item && task.status !== 'running') {
      reject('invalid_human_interaction', 'Task is not running')
    }
    if (item && (item.id !== command.interactionId || item.status !== 'agent_reviewing_answers')) {
      reject('human_interaction_open', 'Task already has an unresolved human interaction')
    }
    return
  }
  if (!item || item.id !== command.interactionId) {
    return reject('human_interaction_not_found', 'Human interaction is not open for this Task')
  }
  if (command.type === 'answer_human_questions') {
    input.assertUser(command)
    if (item.status !== 'awaiting_human_answers') {
      reject('human_answers_not_expected', 'Interaction is not waiting for answers')
    }
    return
  }
  if (command.type === 'submit_human_understanding') {
    input.assertExecutor(command, task)
    if (item.attemptId !== command.attemptId || item.status !== 'agent_reviewing_answers') {
      reject('human_summary_not_expected', 'Interaction is not waiting for a summary')
    }
    return
  }
  input.assertUser(command)
  if (item.status !== 'ready_for_confirmation') {
    reject('human_confirmation_not_expected', 'Understanding is not ready for confirmation')
  }
}
