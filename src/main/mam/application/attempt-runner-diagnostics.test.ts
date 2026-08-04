import { describe, expect, it } from 'vitest'
import { attemptRunnerErrorCode } from './attempt-runner-diagnostics'

describe('Attempt runner diagnostics', () => {
  it('preserves a machine-readable application error prefix', () => {
    expect(
      attemptRunnerErrorCode(new Error('required_artifact_missing:artifact.design-spec'))
    ).toBe('required_artifact_missing')
  })

  it('does not turn ordinary prose into an error code', () => {
    expect(attemptRunnerErrorCode(new Error('Executor stopped unexpectedly'))).toBe(
      'execution_error'
    )
  })
})
