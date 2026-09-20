import type { StructuredExecutorResult } from '../executors/structured-executor-router'
import type { PreparedAttempt } from './mam-attempt-execution-types'

export function recoveredReviewExecution(
  prepared: PreparedAttempt
): StructuredExecutorResult | undefined {
  if (!prepared.task.reviewTask || !prepared.recoveredAssistantText) return undefined
  return {
    invocation: { source: 'persisted_pi_final_answer' },
    events: [],
    usage: { status: 'unknown' },
    assistantText: prepared.recoveredAssistantText,
    stderr: ''
  }
}
