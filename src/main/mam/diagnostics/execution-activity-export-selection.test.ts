import { describe, expect, it } from 'vitest'
import type { DiagnosticEvent } from './diagnostics-recorder'
import { selectExecutionActivityEvents } from './execution-activity-export-selection'

describe('execution activity export selection', () => {
  it('exports a complete Run or one requested node without crossing Run boundaries', () => {
    const events = [
      event('run.one', 'node.design'),
      event('run.one', 'node.build'),
      event('run.two', 'node.build')
    ]

    expect(
      selectExecutionActivityEvents(events, { workflowRunId: 'run.one' }).map(
        (candidate) => candidate.nodeId
      )
    ).toEqual(['node.design', 'node.build'])
    expect(
      selectExecutionActivityEvents(events, {
        workflowRunId: 'run.one',
        nodeId: 'node.build'
      })
    ).toEqual([events[1]])
  })
})

function event(workflowRunId: string, nodeId: string): DiagnosticEvent {
  return {
    at: '2026-08-05T03:10:00Z',
    workflowRunId,
    nodeId,
    roleInstanceId: 'role-instance.test',
    executorInvocationId: 'executor-invocation.test',
    kind: 'executor',
    payload: { status: 'running' }
  }
}
