import { describe, expect, it, vi } from 'vitest'
import { emptyWorkflowRunProjection } from '../state-store/git-event-projection'
import { MamAutomaticWorkflowRunner } from './mam-automatic-workflow-runner'

describe('MamAutomaticWorkflowRunner', () => {
  it('assigns and starts an executable fixed-role task without UI interaction', async () => {
    const state = fixture('ready')
    const assignments: unknown[] = []
    const starts: unknown[] = []
    const commands = { assignTask: (input: unknown) => assignments.push(input) }
    const attempts = {
      start: vi.fn(async (input: { taskId: string }) => {
        starts.push(input)
        setProjectedTask(state.projection, input.taskId, {
          status: 'running',
          roleProfileId: 'role.developer',
          roleProfileVersion: 1,
          activeAttemptIds: ['attempt.1'],
          knownAttemptIds: ['attempt.1'],
          reviewIds: [],
          executionWarnings: [],
          lastEventId: 'event.running'
        })
        return undefined
      })
    }
    const runner = new MamAutomaticWorkflowRunner(
      attempts as never,
      commands as never,
      () => '2026-08-05T00:00:00Z'
    )
    runner.setRepository(state.repository as never)
    runner.notify()
    await vi.waitFor(() => expect(starts).toHaveLength(1))

    expect(assignments).toEqual([
      {
        workflowRunId: 'run.auto',
        taskId: 'task.develop',
        roleProfileId: 'role.developer',
        roleProfileVersion: 1
      }
    ])
    expect(starts).toEqual([{ workflowRunId: 'run.auto', taskId: 'task.develop' }])
  })

  it('starts a new Attempt when a fixed-role task is waiting for changes', async () => {
    const state = fixture('changes_requested')
    const starts: unknown[] = []
    const attempts = {
      start: vi.fn(async (input: { taskId: string }) => {
        starts.push(input)
        setProjectedTask(state.projection, input.taskId, {
          status: 'running',
          roleProfileId: 'role.developer',
          roleProfileVersion: 1,
          activeAttemptIds: ['attempt.next'],
          knownAttemptIds: ['attempt.previous', 'attempt.next'],
          reviewIds: [],
          executionWarnings: [],
          lastEventId: 'event.running'
        })
      })
    }
    const runner = new MamAutomaticWorkflowRunner(
      attempts as never,
      { assignTask: vi.fn() } as never,
      () => '2026-08-05T00:00:00Z'
    )
    runner.setRepository(state.repository as never)
    runner.notify()
    await vi.waitFor(() => expect(starts).toHaveLength(1))
    expect(starts[0]).toEqual({ workflowRunId: 'run.auto', taskId: 'task.develop' })
  })
})

function fixture(status: 'ready' | 'changes_requested') {
  const projection = emptyWorkflowRunProjection('run.auto')
  if (status === 'changes_requested') {
    setProjectedTask(projection, 'task.develop', {
      status,
      roleProfileId: 'role.developer',
      roleProfileVersion: 1,
      activeAttemptIds: [],
      knownAttemptIds: ['attempt.previous'],
      reviewIds: [],
      executionWarnings: [],
      lastEventId: 'event.changes-requested'
    })
  }
  const bundle = {
    definition: {
      nodes: [
        {
          id: 'develop',
          type: 'role_task',
          recommendedRoleProfileIds: ['role.developer'],
          allowedRoleProfileIds: ['role.developer']
        }
      ],
      edges: []
    },
    plan: {
      nodes: [{ id: 'develop', dependencies: [], successors: [] }],
      edges: []
    },
    run: {
      nodeRuns: [{ nodeId: 'develop', status: 'ready' }],
      roleCatalog: [{ roleProfileId: 'role.developer', roleProfileVersion: 1 }]
    },
    taskCatalog: [
      {
        id: 'task.develop',
        nodeId: 'develop',
        nodeType: 'role_task',
        allowedRoleProfileIds: ['role.developer'],
        recommendedRoleProfileIds: ['role.developer']
      }
    ]
  }
  return {
    projection,
    repository: {
      listWorkflowRunIds: () => ['run.auto'],
      loadRunBundle: () => bundle,
      rebuild: () => projection
    }
  }
}

function setProjectedTask(
  projection: ReturnType<typeof emptyWorkflowRunProjection>,
  taskId: string,
  task: Record<string, unknown>
): void {
  const tasks = projection.tasks as unknown as Record<string, Record<string, unknown>>
  tasks[taskId] = task
}
