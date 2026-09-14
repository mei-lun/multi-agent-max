import { describe, expect, it, vi } from 'vitest'
import {
  attemptRunnerErrorCode,
  recordAttemptRunnerStart,
  recordAttemptRunnerEvent
} from './attempt-runner-diagnostics'
import { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import { diagnosticError } from '../diagnostics/diagnostic-error'

describe('Attempt runner diagnostics', () => {
  it('records actionable startup context and redacts credentials without announcing completion', () => {
    const diagnostics = new DiagnosticsRecorder()
    const onActivityChanged = vi.fn()
    const input = {
      diagnostics,
      onActivityChanged,
      now: () => '2026-09-14T00:00:00Z',
      prepared: {
        workflowRunId: 'run.1',
        taskId: 'task.1',
        attemptId: 'attempt.1',
        executorInvocationId: 'invocation.1',
        nodeId: 'node.1',
        roleInstanceId: 'role-instance.1',
        credentialValues: { provider: 'plain-private-credential' },
        binding: { executablePath: '/bin/pi', configRoot: '/logs/pi' },
        worktree: { path: '/work/task.1' },
        snapshot: {
          executorProfile: { id: 'pi', version: 1 },
          providerProfile: { id: 'provider.1', version: 1 },
          modelProfile: { id: 'model.1', version: 1 },
          contentHash: 'hash.1',
          budget: { maxDurationSeconds: 120 },
          execution: {
            remoteModelId: 'model.remote',
            providerProtocol: 'openai-responses',
            providerBaseUrl:
              'https://user:password@provider.example/v1?key=plain-private-credential#private'
          }
        }
      } as unknown as PreparedAttempt
    }
    recordAttemptRunnerStart(input)
    expect(onActivityChanged).not.toHaveBeenCalled()
    expect(diagnostics.list()[0]).toMatchObject({
      attemptId: 'attempt.1',
      payload: {
        status: 'execution_started',
        endpoint: 'https://provider.example/v1',
        workspacePath: '/work/task.1',
        remoteModelId: 'model.remote'
      }
    })
    recordAttemptRunnerEvent(input, 'executor', {
      error: diagnosticError(new Error('Failed: plain-private-credential'))
    })
    const log = JSON.stringify(diagnostics.list())
    expect(log).not.toMatch(/plain-private-credential|password@|user:|#private/)
    expect(log).toContain('[REDACTED]')
    expect(log).toContain('stack')
  })

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
