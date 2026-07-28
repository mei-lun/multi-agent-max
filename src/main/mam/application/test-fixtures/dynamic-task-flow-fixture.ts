import type { ArtifactVersion } from '../../../../shared/mam/domain/artifact'
import type { TaskPlan } from '../../../../shared/mam/domain/task-plan'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import { profileContentHash } from '../../profiles/profile-content-hash'
import { createWorkflowRunBundle } from '../workflow-run-factory'

const hash = 'a'.repeat(64)

export function dynamicPlanFixture() {
  const bundle = createWorkflowRunBundle({
    runId: 'run.dynamic',
    definition: dynamicWorkflow(),
    roleCatalog: [
      { roleProfileId: 'role.planner', roleProfileVersion: 1, contentHash: hash },
      { roleProfileId: 'role.developer', roleProfileVersion: 2, contentHash: hash },
      { roleProfileId: 'role.reviewer', roleProfileVersion: 1, contentHash: hash }
    ],
    createdAt: '2026-07-28T13:00:00Z'
  })
  const sourceTask = bundle.taskCatalog[0]!
  const sourceAttemptId = 'attempt.plan.1'
  const plan: TaskPlan = {
    schemaVersion: '1.0.0',
    id: 'task-plan.1',
    workflowRunId: bundle.run.id,
    nodeRunId: sourceTask.nodeRunId,
    sourceTaskId: sourceTask.id,
    sourceAttemptId,
    tasks: [
      {
        id: 'implementation',
        title: 'Implement feature',
        specification: 'Implement the accepted design.',
        dependencies: [],
        inputArtifacts: [],
        outputContracts: [dynamicOutputContract('artifact.implementation')],
        recommendedRoleProfileIds: ['role.developer'],
        allowedRoleProfileIds: ['role.developer']
      },
      {
        id: 'verification',
        title: 'Verify feature',
        specification: 'Verify the implementation.',
        dependencies: ['implementation'],
        inputArtifacts: [],
        outputContracts: [dynamicOutputContract('artifact.verification')],
        recommendedRoleProfileIds: ['role.reviewer'],
        allowedRoleProfileIds: ['role.reviewer']
      }
    ],
    createdAt: '2026-07-28T13:05:00Z'
  }
  const planArtifact: ArtifactVersion = {
    schemaVersion: '1.0.0',
    id: 'artifact.task-plan.1',
    artifactType: 'artifact.task-plan',
    version: 1,
    workflowRunId: plan.workflowRunId,
    nodeRunId: plan.nodeRunId,
    taskId: plan.sourceTaskId,
    attemptId: plan.sourceAttemptId,
    roleInstanceId: 'role-instance.planner.1',
    format: 'json-schema',
    contentHash: profileContentHash(plan),
    byteSize: 1000,
    storageRef: 'git:mam-state:runs/run.dynamic/task-plans/task-plan.1.json',
    availability: 'git',
    inputs: [],
    validationStatus: 'valid',
    createdAt: plan.createdAt
  }
  return {
    bundle,
    sourceTaskId: sourceTask.id,
    sourceAttemptId,
    plan,
    planArtifact
  }
}

function dynamicWorkflow(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.dynamic',
    name: 'Dynamic tasks',
    version: 1,
    nodes: [
      {
        id: 'plan',
        type: 'dynamic_tasks',
        recommendedRoleProfileIds: ['role.planner'],
        allowedRoleProfileIds: ['role.planner'],
        planContract: {
          schemaVersion: '1.0.0',
          artifactType: 'artifact.task-plan',
          format: 'json-schema',
          required: true,
          maxBytes: 100_000,
          jsonSchema: { type: 'object' }
        },
        maxTasks: 2
      },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [{ from: 'plan', to: 'finish' }],
    maxTransitions: 20,
    maxRunCostUsd: 20,
    maxRunDurationSeconds: 3600
  }
}

function dynamicOutputContract(artifactType: string) {
  return {
    schemaVersion: '1.0.0' as const,
    artifactType,
    format: 'diff' as const,
    required: true,
    maxBytes: 1_000_000
  }
}
