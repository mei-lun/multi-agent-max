import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MamAttemptPanel } from './MamAttemptPanel'

describe('MamAttemptPanel', () => {
  it('offers same-Attempt continuation after an Executor timeout', () => {
    expect(renderAttempt('executor_timeout')).toContain('Continue Attempt')
  })

  it('keeps non-timeout Executor interruptions on the reconciliation path', () => {
    expect(renderAttempt('executor_error')).not.toContain('Continue Attempt')
  })
})

function renderAttempt(code: string): string {
  return renderToStaticMarkup(
    <MamAttemptPanel
      workflowRunId="run.test"
      attempt={
        {
          id: 'attempt.test',
          taskId: 'task.test',
          status: 'running',
          interruption: {
            stage: 'executor',
            code,
            summary: 'The Executor stopped.',
            nextStep: 'Continue the existing Draft.',
            worktreeRetained: true
          }
        } as never
      }
      selected={false}
      latest
      pending={false}
      onStartAttempt={async () => undefined}
      onRecoverAttempt={async () => undefined}
      onSelectAttempt={async () => undefined}
      onGetAttemptDiff={async () => ({
        attemptId: 'attempt.test',
        submittedCommit: 'abcdef1',
        diff: '',
        byteLength: 0,
        truncated: false
      })}
    />
  )
}
