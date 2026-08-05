import { describe, expect, it, vi } from 'vitest'
import type { ExecutorEvent } from '../../../shared/mam/executor-events'
import { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import type { PreparedAttemptRunnerInput } from './mam-attempt-background-runner'
import { AttemptExecutorEventObserver } from './attempt-executor-event-observer'

describe('AttemptExecutorEventObserver', () => {
  it('batches streaming message deltas before recording diagnostics', () => {
    const diagnostics = new DiagnosticsRecorder()
    const onActivityChanged = vi.fn()
    const observer = new AttemptExecutorEventObserver({
      prepared: {
        workflowRunId: 'run.live',
        nodeId: 'node.live',
        taskId: 'task.live',
        attemptId: 'attempt.live',
        roleInstanceId: 'role-instance.live',
        executorInvocationId: 'executor-invocation.live'
      },
      diagnostics,
      now: () => '2026-08-05T02:30:00Z',
      onActivityChanged
    } as unknown as PreparedAttemptRunnerInput)

    observer.observe(messageEvent('hello '))
    observer.observe(messageEvent('world'))
    observer.recordReturned([])

    expect(diagnostics.list()).toHaveLength(1)
    expect(diagnostics.list()[0]).toMatchObject({
      taskId: 'task.live',
      attemptId: 'attempt.live',
      payload: { event: { payload: { textDelta: 'hello world' } } }
    })
    expect(onActivityChanged).toHaveBeenCalledOnce()
  })
})

function messageEvent(delta: string): ExecutorEvent {
  return {
    schemaVersion: '1.0.0',
    type: 'agent_message',
    timestamp: '2026-08-05T02:30:00Z',
    executorKind: 'pi-rpc',
    executorInvocationId: 'executor-invocation.live',
    sourceEventType: 'message_update',
    payload: { assistantMessageEvent: { delta } }
  }
}
