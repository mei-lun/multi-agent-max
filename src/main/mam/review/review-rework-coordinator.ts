import type { ReviewAggregation } from '../../../shared/mam/domain/review'
import type { Attempt, Task } from '../../../shared/mam/domain/task'
import {
  startAttempt,
  type AttemptStartInput,
  type AttemptStartResult
} from '../application/task-assignment-service'
import { ReviewLoopPolicy, type ReviewLoopState } from '../workflow/review-loop-policy'

export type ReviewReworkResult = Readonly<{
  loop: ReviewLoopState
  task?: Task
  attempt?: Attempt
  warning?: AttemptStartResult['warning']
}>

export class ReviewReworkError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ReviewReworkError'
  }
}

export class ReviewReworkCoordinator {
  constructor(private readonly loopPolicy = new ReviewLoopPolicy()) {}

  apply(input: {
    loop: ReviewLoopState
    aggregation: ReviewAggregation
    task: Task
    nextAttempt?: AttemptStartInput
  }): ReviewReworkResult {
    const outcome = this.loopPolicy.applyAggregation(input.loop, input.aggregation)
    if (outcome.status !== 'changes_requested') {
      if (input.nextAttempt) {
        fail('unexpected_rework_attempt', 'Only changes_requested can create a rework Attempt')
      }
      return { loop: outcome }
    }
    if (!input.nextAttempt) {
      fail('rework_attempt_required', 'Changes requested requires a new Attempt')
    }
    if (input.task.attemptIds.at(-1) !== input.loop.activeAttemptId) {
      fail('rework_lineage_mismatch', 'Task latest Attempt differs from the reviewed Attempt')
    }
    const started = startAttempt(input.task, input.nextAttempt)
    if (started.attempt.previousAttemptId !== input.loop.activeAttemptId) {
      fail('rework_lineage_mismatch', 'Rework Attempt does not point to the reviewed Attempt')
    }
    const loop = this.loopPolicy.beginRevision(outcome, started.attempt.id)
    return {
      loop,
      task: started.task,
      attempt: started.attempt,
      ...(started.warning ? { warning: started.warning } : {})
    }
  }
}

function fail(code: string, message: string): never {
  throw new ReviewReworkError(code, message)
}
