import { describe, expect, it } from 'vitest'
import { DiagnosticsRecorder } from './diagnostics-recorder'

describe('DiagnosticsRecorder', () => {
  it('redacts nested secrets while retaining Executor correlation', () => {
    const recorder = new DiagnosticsRecorder()
    recorder.record({
      at: '2026-07-27T10:00:00Z',
      workflowRunId: 'run.1',
      nodeId: 'node.1',
      roleInstanceId: 'role-instance.1',
      executorInvocationId: 'executor-invocation.1',
      kind: 'executor',
      payload: {
        authorization: 'Bearer secret-token',
        nested: { apiKey: 'secret-key' },
        message: 'token=secret-token',
        output: 'received mam-canary-secret-provider and sk-testvalue123'
      }
    })
    expect(recorder.list()[0]).toMatchObject({
      executorInvocationId: 'executor-invocation.1',
      payload: {
        authorization: '[REDACTED]',
        nested: { apiKey: '[REDACTED]' },
        message: 'token=[REDACTED]',
        output: 'received [REDACTED] and [REDACTED]'
      }
    })
  })
})
