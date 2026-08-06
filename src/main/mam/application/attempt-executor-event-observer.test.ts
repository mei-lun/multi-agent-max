import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExecutorEvent } from '../../../shared/mam/executor-events'
import { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import type { PreparedAttemptRunnerInput } from './mam-attempt-background-runner'
import { AttemptExecutorEventObserver } from './attempt-executor-event-observer'

describe('AttemptExecutorEventObserver', () => {
  afterEach(() => vi.useRealTimers())

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

  it('keeps slow text deltas together and ignores thinking updates', () => {
    vi.useFakeTimers()
    const diagnostics = new DiagnosticsRecorder()
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
      now: () => '2026-08-05T02:30:00Z'
    } as unknown as PreparedAttemptRunnerInput)

    observer.observe(messageEvent('slow '))
    vi.advanceTimersByTime(4_000)
    observer.observe(thinkingEvent('private reasoning'))
    observer.observe(messageEvent('response'))
    vi.advanceTimersByTime(4_000)

    expect(diagnostics.list()).toHaveLength(0)
    observer.observe(messageLifecycleEvent('message_end'))

    expect(diagnostics.list()).toHaveLength(2)
    expect(diagnostics.list()[0]?.payload).toMatchObject({
      event: { payload: { textDelta: 'slow response' } }
    })
  })

  it('publishes a bounded live update during a long continuous message', () => {
    vi.useFakeTimers()
    const diagnostics = new DiagnosticsRecorder()
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
      now: () => '2026-08-05T02:30:00Z'
    } as unknown as PreparedAttemptRunnerInput)

    observer.observe(messageEvent('0'))
    for (let index = 1; index <= 7; index += 1) {
      vi.advanceTimersByTime(4_000)
      observer.observe(messageEvent(String(index)))
    }
    vi.advanceTimersByTime(2_000)

    expect(diagnostics.list()).toHaveLength(1)
    expect(diagnostics.list()[0]?.payload).toMatchObject({
      event: { payload: { textDelta: '01234567' } }
    })
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
    payload: { assistantMessageEvent: { type: 'text_delta', delta } }
  }
}

function thinkingEvent(delta: string): ExecutorEvent {
  return {
    ...messageEvent(delta),
    payload: { assistantMessageEvent: { type: 'thinking_delta', delta } }
  }
}

function messageLifecycleEvent(sourceEventType: 'message_start' | 'message_end'): ExecutorEvent {
  return {
    ...messageEvent(''),
    sourceEventType,
    payload: { message: { role: 'assistant', contentTypes: ['text'] } }
  }
}
