import { describe, expect, it } from 'vitest'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import { emptyWorkflowRunProjection } from '../state-store/git-event-projection'
import { createWorkflowRunBundle } from './workflow-run-factory'
import { MamUiQueryService } from './mam-ui-query-service'

const hash = 'a'.repeat(64)

describe('approval gate availability', () => {
  it('exposes a pending gate only after all upstream nodes pass', () => {
    const bundle = createWorkflowRunBundle({
      runId: 'run.approval-availability',
      definition: workflow(),
      roleCatalog: [{ roleProfileId: 'role.builder', roleProfileVersion: 1, contentHash: hash }],
      createdAt: '2026-08-04T12:00:00Z'
    })
    const empty = emptyWorkflowRunProjection(bundle.run.id)
    expect(snapshot(bundle, empty).approvalGates).toEqual([])

    const taskId = bundle.taskCatalog[0]!.id
    const afterBuild = {
      ...empty,
      tasks: {
        [taskId]: {
          status: 'submitted' as const,
          roleProfileId: 'role.builder',
          roleProfileVersion: 1,
          assignedByUserId: 'user.owner',
          activeAttemptIds: [],
          knownAttemptIds: ['attempt.build'],
          reviewIds: [],
          executionWarnings: [],
          lastEventId: 'event.result'
        }
      }
    }
    expect(snapshot(bundle, afterBuild).approvalGates).toEqual([
      expect.objectContaining({ id: 'approve', status: 'pending' })
    ])
  })
})

function snapshot(
  bundle: ReturnType<typeof createWorkflowRunBundle>,
  projection: ReturnType<typeof emptyWorkflowRunProjection>
) {
  const service = new MamUiQueryService(
    { roles: { listActive: () => [] }, workflows: { listActive: () => [] } },
    {
      listWorkflowRunIds: () => [bundle.run.id],
      loadRunBundle: () => bundle,
      rebuild: () => projection
    },
    () => '2026-08-04T12:01:00Z'
  )
  return service.getSnapshot().runs[0]!
}

function workflow(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.approval-availability',
    name: 'Approval availability',
    version: 1,
    nodes: [
      {
        id: 'build',
        type: 'role_task',
        recommendedRoleProfileIds: ['role.builder'],
        allowedRoleProfileIds: ['role.builder'],
        instruction: 'Build.',
        workspaceMode: 'write',
        inputs: [],
        outputs: [
          {
            schemaVersion: '1.0.0',
            artifactType: 'artifact.output',
            format: 'file-set',
            required: true,
            maxBytes: 1000,
            allowedGlobs: ['index.html']
          }
        ]
      },
      { id: 'approve', type: 'approval_gate', prompt: 'Continue?', options: ['Continue'] },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [
      { from: 'build', to: 'approve' },
      { from: 'approve', to: 'finish' }
    ],
    maxTransitions: 10,
    maxRunCostUsd: 10,
    maxRunDurationSeconds: 600
  }
}
