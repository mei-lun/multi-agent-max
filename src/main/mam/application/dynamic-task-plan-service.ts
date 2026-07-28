import { createHash } from 'node:crypto'
import type { ArtifactVersion } from '../../../shared/mam/domain/artifact'
import {
  DynamicTaskDefinitionSchema,
  TaskPlanSchema,
  type DynamicTaskDefinition,
  type TaskPlan
} from '../../../shared/mam/domain/task-plan'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import { profileContentHash } from '../profiles/profile-content-hash'

export class DynamicTaskPlanError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'DynamicTaskPlanError'
  }
}

export function materializeDynamicTaskPlan(input: {
  bundle: WorkflowRunBundle
  sourceTaskId: string
  sourceAttemptId: string
  plan: TaskPlan
  planArtifact: ArtifactVersion
  existingTaskIds?: ReadonlySet<string>
}): readonly DynamicTaskDefinition[] {
  const plan = TaskPlanSchema.parse(input.plan)
  const sourceTask = input.bundle.taskCatalog.find((task) => task.id === input.sourceTaskId)
  if (!sourceTask || sourceTask.nodeType !== 'dynamic_tasks') {
    fail('dynamic_source_task_invalid', 'Task Plan source is not a dynamic_tasks Task')
  }
  const node = input.bundle.definition.nodes.find((candidate) => candidate.id === sourceTask.nodeId)
  if (!node || node.type !== 'dynamic_tasks') {
    fail('dynamic_source_node_invalid', 'Task Plan source node is not dynamic_tasks')
  }
  assertPlanAuthority(plan, input, sourceTask.nodeRunId)
  assertPlanArtifact(plan, input.planArtifact, node.planContract.artifactType)
  if (plan.tasks.length > node.maxTasks) {
    fail('dynamic_task_limit_exceeded', 'Task Plan exceeds the Workflow node task limit')
  }
  assertPlanGraph(plan)
  assertPlanRoles(plan, input.bundle)
  const planHash = profileContentHash(plan)
  if (input.planArtifact.contentHash !== planHash) {
    fail('task_plan_hash_mismatch', 'Task Plan does not match its immutable Artifact hash')
  }
  const taskIds = new Map(
    plan.tasks.map((item) => [item.id, stableDynamicTaskId(input.bundle.run.id, plan.id, item.id)])
  )
  const reserved = new Set([
    ...input.bundle.taskCatalog.map((task) => task.id),
    ...(input.existingTaskIds ?? [])
  ])
  for (const taskId of taskIds.values()) {
    if (reserved.has(taskId)) fail('dynamic_task_id_collision', 'Dynamic Task ID already exists')
  }
  return Object.freeze(
    plan.tasks.map((item) =>
      DynamicTaskDefinitionSchema.parse({
        schemaVersion: '1.0.0',
        id: taskIds.get(item.id),
        workflowRunId: plan.workflowRunId,
        nodeRunId: plan.nodeRunId,
        nodeId: sourceTask.nodeId,
        parentTaskId: sourceTask.id,
        sourceAttemptId: plan.sourceAttemptId,
        taskPlanId: plan.id,
        taskPlanHash: planHash,
        planItemId: item.id,
        initialStatus:
          item.dependencies.length === 0 ? 'waiting_role_assignment' : 'waiting_dependencies',
        title: item.title,
        specification: item.specification,
        dependencies: item.dependencies.map((dependency) => taskIds.get(dependency)!),
        inputArtifacts: item.inputArtifacts,
        outputContracts: item.outputContracts,
        recommendedRoleProfileIds: item.recommendedRoleProfileIds,
        allowedRoleProfileIds: item.allowedRoleProfileIds
      })
    )
  )
}

function assertPlanAuthority(
  plan: TaskPlan,
  input: {
    bundle: WorkflowRunBundle
    sourceTaskId: string
    sourceAttemptId: string
  },
  nodeRunId: string
): void {
  if (
    plan.workflowRunId !== input.bundle.run.id ||
    plan.nodeRunId !== nodeRunId ||
    plan.sourceTaskId !== input.sourceTaskId ||
    plan.sourceAttemptId !== input.sourceAttemptId
  ) {
    fail('task_plan_binding_mismatch', 'Task Plan authority fields do not match its source Attempt')
  }
}

function assertPlanArtifact(
  plan: TaskPlan,
  artifact: ArtifactVersion,
  expectedArtifactType: string
): void {
  if (
    artifact.workflowRunId !== plan.workflowRunId ||
    artifact.nodeRunId !== plan.nodeRunId ||
    artifact.taskId !== plan.sourceTaskId ||
    artifact.attemptId !== plan.sourceAttemptId ||
    artifact.artifactType !== expectedArtifactType
  ) {
    fail('task_plan_artifact_binding_mismatch', 'Task Plan Artifact targets another source')
  }
  if (artifact.format !== 'json-schema' || artifact.availability !== 'git') {
    fail('task_plan_artifact_not_git', 'Task Plan must be a Git-readable JSON Artifact')
  }
  if (artifact.validationStatus !== 'valid') {
    fail('task_plan_artifact_invalid', 'Task Plan Artifact has not passed validation')
  }
}

function assertPlanGraph(plan: TaskPlan): void {
  const ids = new Set<string>()
  for (const task of plan.tasks) {
    if (ids.has(task.id)) fail('duplicate_dynamic_task', `Task Plan repeats ${task.id}`)
    ids.add(task.id)
  }
  for (const task of plan.tasks) {
    if (task.dependencies.includes(task.id)) {
      fail('dynamic_task_self_dependency', `Dynamic Task ${task.id} depends on itself`)
    }
    if (task.dependencies.some((dependency) => !ids.has(dependency))) {
      fail('dynamic_task_dependency_unknown', `Dynamic Task ${task.id} has an unknown dependency`)
    }
  }
  if (hasDependencyCycle(plan)) {
    fail('dynamic_task_cycle', 'Task Plan contains a dependency cycle')
  }
}

function assertPlanRoles(plan: TaskPlan, bundle: WorkflowRunBundle): void {
  const catalog = new Set(bundle.run.roleCatalog.map((entry) => entry.roleProfileId))
  for (const task of plan.tasks) {
    const allowed = new Set(task.allowedRoleProfileIds)
    const referenced = [...allowed, ...task.recommendedRoleProfileIds]
    if (referenced.some((roleId) => !catalog.has(roleId))) {
      fail('dynamic_role_not_in_run_catalog', 'Task Plan references a Role outside the frozen Run')
    }
    if (task.recommendedRoleProfileIds.some((roleId) => !allowed.has(roleId))) {
      fail('dynamic_role_recommendation_denied', 'Recommended Role is outside the Task allowlist')
    }
  }
}

function hasDependencyCycle(plan: TaskPlan): boolean {
  const remaining = new Map(plan.tasks.map((task) => [task.id, task.dependencies.length]))
  const successors = new Map(plan.tasks.map((task) => [task.id, [] as string[]]))
  for (const task of plan.tasks) {
    for (const dependency of task.dependencies) successors.get(dependency)!.push(task.id)
  }
  const ready = [...remaining].filter(([, count]) => count === 0).map(([id]) => id)
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    for (const successor of successors.get(ready[cursor]!) ?? []) {
      const count = remaining.get(successor)! - 1
      remaining.set(successor, count)
      if (count === 0) ready.push(successor)
    }
  }
  return ready.length !== plan.tasks.length
}

function stableDynamicTaskId(runId: string, planId: string, itemId: string): string {
  const digest = createHash('sha256').update(`${runId}\0${planId}\0${itemId}`).digest('hex')
  return `dynamic-task.${digest.slice(0, 40)}`
}

function fail(code: string, message: string): never {
  throw new DynamicTaskPlanError(code, message)
}
