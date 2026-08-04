import { describe, expect, it } from 'vitest'
import type { GitStateRepository } from '../state-store/git-state-repository'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import { shouldAutomaticallyRetryAttempt } from './attempt-automatic-retry'

describe('automatic Attempt retry', () => {
  it('retries a safe local result failure within the frozen Role limit', () => {
    expect(
      shouldAutomaticallyRetryAttempt({
        prepared: preparedAttempt(2),
        repository: repositoryWithAttempts(['attempt.first']),
        error: new Error('required_artifact_missing:artifact.design-spec'),
        executorCompleted: true
      })
    ).toBe(true)
  })

  it('does not replay when executor side effects may be unknown', () => {
    expect(
      shouldAutomaticallyRetryAttempt({
        prepared: preparedAttempt(2),
        repository: repositoryWithAttempts(['attempt.first']),
        error: new Error('executor_disconnected'),
        executorCompleted: false
      })
    ).toBe(false)
  })

  it('retries an internal Artifact contract mismatch without user intervention', () => {
    expect(
      shouldAutomaticallyRetryAttempt({
        prepared: preparedAttempt(2),
        repository: repositoryWithAttempts(['attempt.first']),
        error: new Error('artifact_contract_invalid:missing status'),
        executorCompleted: true
      })
    ).toBe(true)
  })

  it('stops after the frozen Role attempt limit', () => {
    expect(
      shouldAutomaticallyRetryAttempt({
        prepared: preparedAttempt(2),
        repository: repositoryWithAttempts(['attempt.first', 'attempt.second']),
        error: new Error('automatic_review_output_invalid'),
        executorCompleted: true
      })
    ).toBe(false)
  })
})

function preparedAttempt(retryMaxAttempts: number): PreparedAttempt {
  return {
    workflowRunId: 'run.one',
    taskId: 'task.one',
    retryMaxAttempts
  } as PreparedAttempt
}

function repositoryWithAttempts(knownAttemptIds: readonly string[]): GitStateRepository {
  return {
    rebuild: () => ({ tasks: { 'task.one': { knownAttemptIds } } })
  } as unknown as GitStateRepository
}
