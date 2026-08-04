import { describe, expect, it } from 'vitest'
import type { MergeQueueEntry } from '../../../shared/mam/domain/merge-queue'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import { emptyWorkflowRunProjection } from '../state-store/git-event-projection'
import { createWorkflowRunBundle } from './workflow-run-factory'
import { MamUiQueryService } from './mam-ui-query-service'

const hash = 'a'.repeat(64)

describe('MAM UI query service', () => {
  it('keeps a local-only project connected without inventing a remote', () => {
    const bundle = runBundle()
    const service = new MamUiQueryService(
      { roles: { listActive: () => [] }, workflows: { listActive: () => [] } },
      {
        listWorkflowRunIds: () => [],
        loadRunBundle: () => undefined,
        rebuild: () => emptyWorkflowRunProjection(bundle.run.id),
        projectDirectory: '/projects/local-only',
        stateDirectory: '/projects/.local-only-mam-state',
        collaborationMode: 'local',
        branch: 'mam-state'
      }
    )

    expect(service.getSnapshot().projectBinding).toEqual({
      projectDirectory: '/projects/local-only',
      stateDirectory: '/projects/.local-only-mam-state',
      collaborationMode: 'local',
      branch: 'mam-state'
    })
  })

  it('builds a deterministic Renderer snapshot without exposing state stores', () => {
    const bundle = runBundle()
    const projection = {
      ...emptyWorkflowRunProjection(bundle.run.id),
      mergeQueueEntries: {
        'merge-entry.b': queueEntry('task.b', '2026-07-28T18:01:00Z'),
        'merge-entry.a': queueEntry('task.a', '2026-07-28T18:00:00Z')
      }
    }
    const service = new MamUiQueryService(
      {
        roles: { listActive: () => [] },
        workflows: { listActive: () => [bundle.definition] }
      },
      {
        listWorkflowRunIds: () => ['run.missing', bundle.run.id],
        loadRunBundle: (runId) => (runId === bundle.run.id ? bundle : undefined),
        rebuild: () => projection
      },
      () => '2026-07-28T19:00:00Z'
    )

    const snapshot = service.getSnapshot()
    expect(snapshot.generatedAt).toBe('2026-07-28T19:00:00Z')
    expect(snapshot.workflows.map((workflow) => workflow.id)).toEqual(['workflow.ui'])
    expect(snapshot.runs[0]).toMatchObject({
      definitionName: 'UI projection',
      run: { id: 'run.ui', status: 'completed' }
    })
    expect(snapshot.runs[0]?.mergeQueueEntries.map((entry) => entry.taskId)).toEqual([
      'task.a',
      'task.b'
    ])
    expect(snapshot.issues).toEqual([
      {
        code: 'run_bundle_missing',
        workflowRunId: 'run.missing',
        message: 'Run Bundle is missing from authoritative Git state'
      }
    ])
  })

  it('reports rebuild errors as persistent snapshot issues', () => {
    const bundle = runBundle()
    const service = new MamUiQueryService(
      {
        roles: { listActive: () => [] },
        workflows: { listActive: () => [] }
      },
      {
        listWorkflowRunIds: () => [bundle.run.id],
        loadRunBundle: () => bundle,
        rebuild: () => {
          throw Object.assign(new Error('State batch is corrupt'), { code: 'corrupt_event_batch' })
        }
      },
      () => '2026-07-28T19:00:00Z'
    )
    expect(service.getSnapshot().issues[0]).toEqual({
      code: 'corrupt_event_batch',
      workflowRunId: bundle.run.id,
      message: 'State batch is corrupt'
    })
  })

  it('projects the executor diagnostic beside a reconciled Attempt', () => {
    const bundle = createWorkflowRunBundle({
      runId: 'run.interrupted-ui',
      definition: taskWorkflow(),
      roleCatalog: [{ roleProfileId: 'role.builder', roleProfileVersion: 1, contentHash: hash }],
      createdAt: '2026-07-28T17:00:00Z'
    })
    const projection = {
      ...emptyWorkflowRunProjection(bundle.run.id),
      attempts: {
        'attempt.interrupted': {
          taskId: 'build',
          status: 'needs_reconciliation' as const,
          executorInvocationId: 'invocation.interrupted',
          lastEventId: 'event.attempt-interrupted'
        }
      }
    }
    const service = new MamUiQueryService(
      { roles: { listActive: () => [] }, workflows: { listActive: () => [] } },
      {
        listWorkflowRunIds: () => [bundle.run.id],
        loadRunBundle: () => bundle,
        rebuild: () => projection
      },
      () => '2026-07-28T19:00:00Z',
      {
        list: () => [
          {
            at: '2026-07-28T18:00:00Z',
            workflowRunId: bundle.run.id,
            nodeId: 'build',
            roleInstanceId: 'role-instance.builder',
            executorInvocationId: 'invocation.interrupted',
            kind: 'executor' as const,
            payload: {
              status: 'execution_interrupted',
              errorCode: 'structured_result_invalid',
              message: 'Pi result is not JSON',
              worktreeRetained: true
            }
          }
        ]
      }
    )

    expect(service.getSnapshot().runs[0]?.attempts[0]?.interruption).toEqual({
      stage: 'result_validation',
      code: 'structured_result_invalid',
      detail: 'Pi result is not JSON',
      summary: 'The Role finished, but MAM could not accept a complete result.',
      nextStep: 'Choose Retry this Task. MAM will create a fresh Attempt and keep the old record.',
      worktreeRetained: true
    })
  })

  it('joins frozen Task definitions onto projected task state', () => {
    const bundle = createWorkflowRunBundle({
      runId: 'run.task-ui',
      definition: taskWorkflow(),
      roleCatalog: [{ roleProfileId: 'role.builder', roleProfileVersion: 1, contentHash: hash }],
      createdAt: '2026-07-28T17:00:00Z'
    })
    const definition = bundle.taskCatalog[0]!
    const projection = {
      ...emptyWorkflowRunProjection(bundle.run.id),
      tasks: {
        [definition.id]: {
          status: 'waiting_role_assignment' as const,
          roleProfileId: 'role.builder',
          assignedByUserId: 'user.owner',
          activeAttemptIds: [],
          knownAttemptIds: [],
          reviewIds: [],
          executionWarnings: [],
          lastEventId: 'event.task-created'
        }
      }
    }
    const service = new MamUiQueryService(
      { roles: { listActive: () => [] }, workflows: { listActive: () => [] } },
      {
        listWorkflowRunIds: () => [bundle.run.id],
        loadRunBundle: () => bundle,
        rebuild: () => projection
      },
      () => '2026-07-28T19:00:00Z'
    )

    expect(service.getSnapshot().runs[0]?.tasks[0]).toMatchObject({
      id: definition.id,
      title: 'build',
      kind: 'static',
      roleProfileId: 'role.builder',
      assignedByUserId: 'user.owner',
      dependencies: [],
      recommendedRoleProfileIds: ['role.builder'],
      allowedRoleProfileIds: ['role.builder']
    })
  })

  it('exposes an unassigned frozen Task before its first state event', () => {
    const bundle = createWorkflowRunBundle({
      runId: 'run.unassigned-ui',
      definition: taskWorkflow(),
      roleCatalog: [{ roleProfileId: 'role.builder', roleProfileVersion: 1, contentHash: hash }],
      createdAt: '2026-07-28T17:00:00Z'
    })
    const projection = emptyWorkflowRunProjection(bundle.run.id)
    const service = new MamUiQueryService(
      { roles: { listActive: () => [] }, workflows: { listActive: () => [] } },
      {
        listWorkflowRunIds: () => [bundle.run.id],
        loadRunBundle: () => bundle,
        rebuild: () => projection
      },
      () => '2026-07-28T19:00:00Z'
    )

    expect(service.getSnapshot().runs[0]?.tasks[0]).toMatchObject({
      title: 'build',
      status: 'waiting_role_assignment',
      allowedRoleProfileIds: ['role.builder'],
      attemptIds: []
    })
  })

  it('projects the immutable Review subject for evidence inspection', () => {
    const bundle = runBundle()
    const subject = {
      taskId: 'task.build',
      attemptId: 'attempt.build',
      resultHash: hash,
      artifactHashes: [hash],
      submittedCommit: 'abcdef1234567'
    }
    const projection = {
      ...emptyWorkflowRunProjection(bundle.run.id),
      reviewTasks: {
        'review-task.ui': {
          schemaVersion: '1.0.0' as const,
          id: 'review-task.ui',
          workflowRunId: bundle.run.id,
          nodeRunId: 'node-review.ui',
          reviewNodeId: 'review.ui',
          subject,
          initialStatus: 'waiting_role_assignment' as const,
          title: 'Review submitted work',
          specification: 'Inspect the submitted work and record a decision.',
          inputArtifacts: [],
          outputContracts: [
            {
              schemaVersion: '1.0.0' as const,
              artifactType: 'artifact.review-report',
              format: 'json-schema' as const,
              required: true,
              maxBytes: 1024,
              jsonSchema: { type: 'object' }
            }
          ],
          recommendedRoleProfileIds: [],
          allowedRoleProfileIds: ['role.reviewer']
        }
      }
    }
    const service = new MamUiQueryService(
      { roles: { listActive: () => [] }, workflows: { listActive: () => [] } },
      {
        listWorkflowRunIds: () => [bundle.run.id],
        loadRunBundle: () => bundle,
        rebuild: () => projection
      },
      () => '2026-07-28T19:00:00Z'
    )

    expect(
      service.getSnapshot().runs[0]?.tasks.find((task) => task.id === 'review-task.ui')
        ?.reviewSubject
    ).toEqual(subject)
  })
})

function queueEntry(taskId: string, mergeReadyAt: string): MergeQueueEntry {
  return {
    schemaVersion: '1.0.0',
    id: `merge-entry.${taskId.at(-1)}`,
    workflowRunId: 'run.ui',
    mergeNodeId: 'merge',
    taskId,
    attemptId: `attempt.${taskId}`,
    targetBranch: 'develop',
    sourceBranch: `tasks/${taskId}`,
    submittedCommit: 'abcdef1',
    resultHash: hash,
    mergeReadyAt,
    readyRevisionHash: hash,
    reviewDecisionIds: [`review.${taskId}`],
    validationEvidence: {},
    strategy: 'no_ff',
    conflictPolicy: 'coordinator_attempt',
    status: 'queued'
  }
}

function runBundle() {
  return createWorkflowRunBundle({
    runId: 'run.ui',
    definition: workflow(),
    roleCatalog: [],
    createdAt: '2026-07-28T17:00:00Z'
  })
}

function workflow(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.ui',
    name: 'UI projection',
    version: 1,
    nodes: [{ id: 'finish', type: 'finish', inputs: [] }],
    edges: [],
    maxTransitions: 10,
    maxRunCostUsd: 10,
    maxRunDurationSeconds: 600
  }
}

function taskWorkflow(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.task-ui',
    name: 'Task UI projection',
    version: 1,
    nodes: [
      {
        id: 'build',
        type: 'role_task',
        recommendedRoleProfileIds: ['role.builder'],
        allowedRoleProfileIds: ['role.builder'],
        instruction: 'Build the feature.',
        workspaceMode: 'write',
        inputs: [],
        outputs: [
          {
            schemaVersion: '1.0.0',
            artifactType: 'artifact.patch',
            format: 'diff',
            required: true,
            maxBytes: 1_000_000
          }
        ]
      },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [{ from: 'build', to: 'finish' }],
    maxTransitions: 10,
    maxRunCostUsd: 10,
    maxRunDurationSeconds: 600
  }
}
