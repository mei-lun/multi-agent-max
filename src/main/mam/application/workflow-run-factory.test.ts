import { describe, expect, it } from 'vitest'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import { createWorkflowRunBundle, createWorkflowRunCommand } from './workflow-run-factory'

const hash = 'a'.repeat(64)

describe('Workflow Run factory', () => {
  it('freezes a deterministic Role and static Task catalog for arbitrary Role IDs', () => {
    const input = {
      runId: 'run.parallel',
      definition: parallelWorkflow(),
      roleCatalog: roleCatalog(),
      createdAt: '2026-07-28T02:00:00Z'
    }
    const first = createWorkflowRunBundle(input)
    const second = createWorkflowRunBundle({
      ...input,
      roleCatalog: [...input.roleCatalog].reverse()
    })

    expect(second).toEqual(first)
    expect(first.run.roleCatalog.map((entry) => entry.roleProfileId)).toEqual([
      'role.builder-a',
      'role.builder-b'
    ])
    expect(first.taskCatalog).toHaveLength(2)
    expect(first.taskCatalog.map((task) => task.id).every((id) => id.startsWith('task.'))).toBe(
      true
    )
    expect(first.taskCatalog.map((task) => task.initialStatus)).toEqual([
      'waiting_dependencies',
      'waiting_dependencies'
    ])
    expect(first.run.nodeRuns.find((node) => node.nodeId === 'fan-out')?.status).toBe('ready')
    expect(
      createWorkflowRunCommand({
        bundle: first,
        commandId: 'command.create.parallel',
        schedulerId: 'scheduler.1',
        issuedAt: input.createdAt
      })
    ).toMatchObject({
      type: 'create_workflow_run',
      workflowRunId: 'run.parallel',
      planHash: first.plan.planHash,
      roleCatalogHash: first.roleCatalogHash
    })
  })

  it('rejects a Workflow Role outside the frozen Run catalog', () => {
    expect(() =>
      createWorkflowRunBundle({
        runId: 'run.invalid',
        definition: parallelWorkflow(),
        roleCatalog: roleCatalog().slice(0, 1),
        createdAt: '2026-07-28T02:00:00Z'
      })
    ).toThrow(expect.objectContaining({ code: 'role_not_in_run_catalog' }))
  })
})

function parallelWorkflow(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.parallel',
    name: 'Parallel arbitrary roles',
    version: 1,
    nodes: [
      { id: 'fan-out', type: 'parallel', branches: ['build-a', 'build-b'] },
      roleNode('build-a', 'role.builder-a'),
      roleNode('build-b', 'role.builder-b'),
      { id: 'join', type: 'join', waitFor: ['build-a', 'build-b'] },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [
      { from: 'fan-out', to: 'build-a' },
      { from: 'fan-out', to: 'build-b' },
      { from: 'build-a', to: 'join' },
      { from: 'build-b', to: 'join' },
      { from: 'join', to: 'finish' }
    ],
    maxTransitions: 20,
    maxRunCostUsd: 20,
    maxRunDurationSeconds: 3_600
  }
}

function roleNode(id: string, roleProfileId: string) {
  return {
    id,
    type: 'role_task' as const,
    recommendedRoleProfileIds: [roleProfileId],
    allowedRoleProfileIds: [roleProfileId],
    instruction: `Complete ${id}.`,
    workspaceMode: 'write' as const,
    inputs: [],
    outputs: [
      {
        schemaVersion: '1.0.0' as const,
        artifactType: `artifact.${id}`,
        format: 'diff' as const,
        required: true,
        maxBytes: 1_000_000
      }
    ]
  }
}

function roleCatalog() {
  return [
    { roleProfileId: 'role.builder-b', roleProfileVersion: 3, contentHash: hash },
    { roleProfileId: 'role.builder-a', roleProfileVersion: 2, contentHash: hash }
  ]
}
