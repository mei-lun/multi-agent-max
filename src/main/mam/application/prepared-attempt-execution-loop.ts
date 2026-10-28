import type { StructuredExecutorResult } from '../executors/structured-executor-router'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import type { PreparedAttemptRunnerInput } from './mam-attempt-background-runner'
import { AttemptExecutorEventObserver } from './attempt-executor-event-observer'
import { continuePreparedAttempt } from './pi-session-continuation'
import { recoveredReviewExecution } from './review-output-recovery'
import { executePreparedAttempt } from './prepared-attempt-executor'
import { recordPreparedAttemptDraftState, recordPreparedAttemptRunning } from './prepared-attempt-draft'
import { isRetryableConnectionFailure } from '../executors/pi-rpc-connection-failure'
import {
  attemptRunnerErrorCode as errorCode,
  recordAttemptRunnerEvent as record
} from './attempt-runner-diagnostics'

export type PreparedAttemptExecutionLoopResult = Readonly<{
  prepared: PreparedAttempt
  execution: StructuredExecutorResult
  eventObserver: AttemptExecutorEventObserver
  executorCompleted: boolean
}>

export async function executePreparedAttemptWithTimeoutRecovery(
  input: PreparedAttemptRunnerInput,
  initialPrepared: PreparedAttempt,
  onContinuation: (prepared: PreparedAttempt) => void = () => undefined
): Promise<PreparedAttemptExecutionLoopResult> {
  let prepared = initialPrepared
  let eventObserver = new AttemptExecutorEventObserver({ ...input, prepared })

  while (true) {
    eventObserver = new AttemptExecutorEventObserver({ ...input, prepared })
    try {
      const recoveredExecution = recoveredReviewExecution(prepared)
      const execution =
        recoveredExecution ?? (await executePreparedAttempt(input, prepared, eventObserver))
      return { prepared, execution, eventObserver, executorCompleted: true }
    } catch (error) {
      eventObserver.flush()
      const retryLimit = prepared.retryMaxAttempts ?? 1
      const continuationAttempts = prepared.continuationAttempts ?? 0
      if (!isRetryableConnectionFailure(errorCode(error)) || !input.drafts) throw error
      if (continuationAttempts + 1 >= retryLimit) throw error
      record(input, 'scheduler', {
        status: 'executor_connection_retrying',
        retryAttempt: continuationAttempts + 2,
        retryLimit
      })
      recordPreparedAttemptDraftState({
        store: input.drafts,
        prepared,
        state: 'waiting_for_resume',
        at: input.now(),
        errorCode: errorCode(error)
      })
      try {
        prepared = continuePreparedAttempt(
          prepared, input.drafts, input.createId('executor-invocation')
        )
      } catch {
        throw error
      }
      recordPreparedAttemptRunning(input.drafts, prepared, input.now())
      onContinuation(prepared)
    }
  }
}
