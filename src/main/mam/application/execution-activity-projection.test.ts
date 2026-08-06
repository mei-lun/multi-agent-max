import { describe, expect, it } from 'vitest'
import type { DiagnosticEvent } from '../diagnostics/diagnostics-recorder'
import { projectExecutionActivities } from './execution-activity-projection'

describe('execution activity projection', () => {
  it('classifies bounded Role messages, commands, and usage for one Run', () => {
    const events: DiagnosticEvent[] = [
      diagnostic('run.other', 'executor', { status: 'ignored' }),
      diagnostic('run.live', 'executor', {
        event: {
          type: 'agent_message',
          sourceEventType: 'message_start',
          payload: { message: { role: 'assistant', contentTypes: ['text'] } }
        }
      }),
      diagnostic('run.live', 'executor', {
        event: {
          type: 'agent_message',
          sourceEventType: 'message_update.batched',
          payload: { textDelta: 'Inspecting ' }
        }
      }),
      diagnostic('run.live', 'executor', {
        event: {
          type: 'agent_message',
          sourceEventType: 'message_update',
          payload: {
            assistantMessageEvent: { type: 'thinking_delta', delta: 'private reasoning' }
          }
        }
      }),
      diagnostic('run.live', 'executor', {
        event: {
          type: 'agent_message',
          sourceEventType: 'message_update.batched',
          payload: { textDelta: 'the workspace.' }
        }
      }),
      diagnostic('run.live', 'executor', {
        event: {
          type: 'tool_event',
          sourceEventType: 'tool_execution_start',
          payload: { toolName: 'bash', args: { command: 'pnpm test' } }
        }
      }),
      diagnostic('run.live', 'cost', {
        usage: { inputTokens: 12, outputTokens: 8, costUsd: 0.004, status: 'reported' }
      })
    ]

    const activities = projectExecutionActivities('run.live', events, [
      {
        id: 'attempt.live',
        taskId: 'task.live',
        status: 'running',
        roleInstanceId: 'role-instance.live'
      }
    ])

    expect(activities).toMatchObject([
      { category: 'message', detail: 'Inspecting the workspace.', taskId: 'task.live' },
      { category: 'command', detail: 'pnpm test' },
      { category: 'usage', detail: '12 input · 8 output · $0.0040' }
    ])
  })
})

function diagnostic(
  workflowRunId: string,
  kind: DiagnosticEvent['kind'],
  payload: Readonly<Record<string, unknown>>
): DiagnosticEvent {
  return {
    at: '2026-08-05T02:30:00Z',
    workflowRunId,
    nodeId: 'node.live',
    roleInstanceId: 'role-instance.live',
    executorInvocationId: 'executor-invocation.live',
    kind,
    payload
  }
}
