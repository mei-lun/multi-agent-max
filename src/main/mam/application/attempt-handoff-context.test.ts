import { describe, expect, it } from 'vitest'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { WorkflowRunProjection } from '../state-store/git-state-projection'
import { resolveAttemptHandoffContext } from './attempt-handoff-context'

describe('Attempt handoff context', () => {
  it('pins a downstream Role to the completed integration commit and lists its input', () => {
    const fixture = handoffFixture(true)
    const resolved = resolveAttemptHandoffContext({
      bundle: fixture.bundle,
      projection: fixture.projection,
      nodeId: 'implement',
      inputArtifacts: [artifactRef()],
      requireIntegratedRoleInputs: true
    })

    expect(resolved.integrationBase).toEqual({
      mergeNodeId: 'integrate-design',
      targetBranch: 'develop',
      mergeCommit: 'd'.repeat(40)
    })
    expect(resolved.inputArtifacts).toEqual([
      expect.objectContaining({
        artifactType: 'artifact.design',
        producerNodeId: 'design',
        producerAttemptId: 'attempt.design',
        sourceCommit: 'a'.repeat(40),
        contentLocations: ['docs/design.md']
      })
    ])
  })

  it('blocks a Role input that is still isolated on the producer Attempt branch', () => {
    const fixture = handoffFixture(false)

    expect(() =>
      resolveAttemptHandoffContext({
        bundle: fixture.bundle,
        projection: fixture.projection,
        nodeId: 'implement',
        inputArtifacts: [artifactRef()],
        requireIntegratedRoleInputs: true
      })
    ).toThrow('workflow_role_handoff_not_integrated:artifact.design')
  })

  it('selects the terminal merge commit by Git ancestry rather than completion time', () => {
    const fixture = handoffFixture(true)
    const earlyTerminal = 'e'.repeat(40)
    const lateAncestor = 'c'.repeat(40)
    const baseEntry = Object.values(fixture.projection.mergeQueueEntries)[0]!
    fixture.projection = {
      ...fixture.projection,
      mergeQueueEntries: {
        ancestor: {
          ...baseEntry,
          id: 'merge-entry.ancestor',
          taskId: 'task.ancestor',
          mergeCommit: lateAncestor,
          completedAt: '2026-09-16T13:00:00Z'
        },
        terminal: {
          ...baseEntry,
          id: 'merge-entry.terminal',
          mergeCommit: earlyTerminal,
          completedAt: '2026-09-16T12:00:00Z'
        }
      }
    } as WorkflowRunProjection

    const resolved = resolveAttemptHandoffContext({
      bundle: fixture.bundle,
      projection: fixture.projection,
      nodeId: 'implement',
      inputArtifacts: [artifactRef()],
      requireIntegratedRoleInputs: true,
      isCommitAncestor: (_branch, ancestor, descendant) =>
        ancestor === descendant || (ancestor === lateAncestor && descendant === earlyTerminal)
    })

    expect(resolved.integrationBase?.mergeCommit).toBe(earlyTerminal)
  })

  it('accepts multiple successful merge entries that share one terminal commit', () => {
    const fixture = handoffFixture(true)
    const baseEntry = Object.values(fixture.projection.mergeQueueEntries)[0]!
    fixture.projection = {
      ...fixture.projection,
      mergeQueueEntries: {
        first: { ...baseEntry, id: 'merge-entry.first' },
        second: { ...baseEntry, id: 'merge-entry.second', taskId: 'task.second' }
      }
    } as WorkflowRunProjection

    const resolved = resolveAttemptHandoffContext({
      bundle: fixture.bundle,
      projection: fixture.projection,
      nodeId: 'implement',
      inputArtifacts: [artifactRef()],
      requireIntegratedRoleInputs: true
    })

    expect(resolved.integrationBase?.mergeCommit).toBe(baseEntry.mergeCommit)
  })
})

function handoffFixture(merged: boolean): {
  bundle: WorkflowRunBundle
  projection: WorkflowRunProjection
} {
  const edges = [
    { from: 'design', to: 'review-design' },
    { from: 'review-design', to: 'integrate-design' },
    { from: 'integrate-design', to: 'implement' }
  ]
  const bundle = {
    definition: {
      nodes: [
        { id: 'design', type: 'role_task', workspaceMode: 'write' },
        { id: 'review-design', type: 'review_gate' },
        { id: 'integrate-design', type: 'git_merge', targetBranch: 'develop' },
        { id: 'implement', type: 'role_task', workspaceMode: 'write' }
      ],
      edges
    },
    plan: {
      nodes: [
        { id: 'design' },
        { id: 'review-design' },
        { id: 'integrate-design' },
        { id: 'implement' }
      ],
      edges
    },
    taskCatalog: [
      {
        id: 'task.design',
        nodeId: 'design',
        outputContracts: [{ artifactType: 'artifact.design', format: 'markdown' }]
      },
      { id: 'task.implement', nodeId: 'implement', outputContracts: [] }
    ]
  } as unknown as WorkflowRunBundle
  const mergeEntry = {
    id: 'merge-entry.design',
    mergeNodeId: 'integrate-design',
    taskId: 'task.design',
    status: 'merged',
    targetBranch: 'develop',
    mergeCommit: 'd'.repeat(40),
    completedAt: '2026-09-16T12:00:00Z',
    mergeReadyAt: '2026-09-16T11:59:00Z'
  }
  const projection = {
    tasks: {
      'task.design': {
        knownAttemptIds: ['attempt.design'],
        selectedAttemptId: 'attempt.design'
      }
    },
    attempts: {
      'attempt.design': {
        status: 'submitted',
        result: {
          status: 'submitted',
          artifacts: [
            {
              type: 'artifact.design',
              contentRef: 'workspace:docs/design.md',
              sha256: 'b'.repeat(64)
            }
          ],
          system: { submittedCommit: 'a'.repeat(40) }
        }
      }
    },
    dynamicTasks: {},
    mergeQueueEntries: merged ? { [mergeEntry.id]: mergeEntry } : {},
    resolvedConditions: {}
  } as unknown as WorkflowRunProjection
  return { bundle, projection }
}

function artifactRef() {
  return { artifactId: 'artifact.design', version: 1, contentHash: '0'.repeat(64) }
}
