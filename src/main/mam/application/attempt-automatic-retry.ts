import type { GitStateRepository } from '../state-store/git-state-repository'
import type { PreparedAttempt } from './mam-attempt-execution-types'

export function shouldAutomaticallyRetryAttempt(input: {
  prepared: PreparedAttempt
  repository: GitStateRepository
  error: unknown
  executorCompleted: boolean
}): boolean {
  if (!input.executorCompleted) return false
  const message = input.error instanceof Error ? input.error.message : String(input.error)
  if (!isRecoverableResultError(message)) return false
  const projection = input.repository.rebuild(input.prepared.workflowRunId)
  const attemptCount = projection.tasks[input.prepared.taskId]?.knownAttemptIds.length ?? 1
  return attemptCount < (input.prepared.retryMaxAttempts ?? 1)
}

function isRecoverableResultError(message: string): boolean {
  return [
    'required_artifact_missing:',
    'artifact_',
    'artifact_output_ambiguous:',
    'direct_artifact_output_',
    'structured_result_',
    'automatic_review_output_invalid'
  ].some((prefix) => message.includes(prefix))
}
