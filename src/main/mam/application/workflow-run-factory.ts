import { createHash } from 'node:crypto'
import type { ArtifactContract, ArtifactRef } from '../../../shared/mam/domain/artifact'
import type { RoleProfile } from '../../../shared/mam/domain/role'
import {
  WorkflowRunBundleSchema,
  type StaticTaskDefinition,
  type WorkflowExecutionPlan,
  type WorkflowRunBundle
} from '../../../shared/mam/domain/run-bundle'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import {
  WorkflowDefinitionSchema,
  type NodeRun,
  type RunRoleCatalogEntry,
  type WorkflowDefinition,
  type WorkflowNode
} from '../../../shared/mam/domain/workflow'
import { profileContentHash } from '../profiles/profile-content-hash'
import { compileWorkflow } from '../workflow/workflow-compiler'

export class WorkflowRunCreationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'WorkflowRunCreationError'
  }
}

export function createWorkflowRunBundle(input: {
  runId: string
  definition: WorkflowDefinition
  roleCatalog: readonly RunRoleCatalogEntry[]
  roleProfiles?: readonly RoleProfile[]
  inputArtifacts?: readonly ArtifactRef[]
  createdAt: string
}): WorkflowRunBundle {
  const definition = WorkflowDefinitionSchema.parse(input.definition)
  const plan = compileWorkflow(definition, input.inputArtifacts ?? [])
  const roleCatalog = [...input.roleCatalog].sort((left, right) =>
    roleKey(left).localeCompare(roleKey(right))
  )
  validateRoleCatalog(definition, roleCatalog)
  const nodeRunIds = new Map(
    plan.nodes.map((node) => [node.id, stableId('node-run', input.runId, node.id, '1')])
  )
  const taskIds = new Map(
    definition.nodes
      .filter(isStaticTaskNode)
      .map((node) => [node.id, stableId('task', input.runId, node.id, '1')])
  )
  const nodeRuns = plan.nodes.map((node) =>
    createNodeRun(node.id, node.dependencies.length === 0, nodeRunIds.get(node.id)!, definition)
  )
  const taskCatalog = definition.nodes
    .filter(isStaticTaskNode)
    .map((node) =>
      createTaskDefinition(node, input.runId, nodeRunIds, taskIds, plan.inputArtifacts, plan)
    )
    .sort((left, right) => left.id.localeCompare(right.id))
  const roleCatalogHash = profileContentHash(roleCatalog)
  const run = {
    schemaVersion: '1.0.0' as const,
    id: input.runId,
    definitionId: definition.id,
    definitionVersion: definition.version,
    planHash: plan.planHash,
    roleCatalog,
    stateBackend: 'git' as const,
    status: 'running' as const,
    nodeRuns,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  }
  const base = {
    schemaVersion: '1.0.0' as const,
    run,
    definition,
    plan,
    roleCatalogHash,
    ...(input.roleProfiles ? { roleProfiles: [...input.roleProfiles] } : {}),
    taskCatalog,
    createdAt: input.createdAt
  }
  return WorkflowRunBundleSchema.parse({ ...base, bundleHash: profileContentHash(base) })
}

export function createWorkflowRunCommand(input: {
  bundle: WorkflowRunBundle
  commandId: string
  schedulerId: string
  issuedAt: string
}): Extract<SchedulerCommand, { type: 'create_workflow_run' }> {
  return {
    schemaVersion: '1.0.0',
    commandId: input.commandId,
    issuedAt: input.issuedAt,
    workflowRunId: input.bundle.run.id,
    actor: { kind: 'scheduler', schedulerId: input.schedulerId },
    type: 'create_workflow_run',
    definitionId: input.bundle.run.definitionId,
    definitionVersion: input.bundle.run.definitionVersion,
    planHash: input.bundle.run.planHash,
    roleCatalogHash: input.bundle.roleCatalogHash
  }
}

function createNodeRun(
  nodeId: string,
  isEntry: boolean,
  nodeRunId: string,
  definition: WorkflowDefinition
): NodeRun {
  const node = definition.nodes.find((candidate) => candidate.id === nodeId)!
  return {
    schemaVersion: '1.0.0',
    id: nodeRunId,
    nodeId,
    attemptIds: [],
    status: isEntry
      ? isStaticTaskNode(node)
        ? 'waiting_role_assignment'
        : 'ready'
      : 'waiting_dependencies'
  }
}

function createTaskDefinition(
  node: Extract<WorkflowNode, { recommendedRoleProfileIds: string[] }>,
  runId: string,
  nodeRunIds: ReadonlyMap<string, string>,
  taskIds: ReadonlyMap<string, string>,
  inputArtifacts: readonly ArtifactRef[],
  plan: WorkflowExecutionPlan
): StaticTaskDefinition {
  const planNode = plan.nodes.find((candidate) => candidate.id === node.id)!
  return {
    schemaVersion: '1.0.0',
    id: taskIds.get(node.id)!,
    workflowRunId: runId,
    nodeRunId: nodeRunIds.get(node.id)!,
    nodeId: node.id,
    nodeType: node.type,
    iteration: 1,
    initialStatus:
      planNode.dependencies.length === 0 ? 'waiting_role_assignment' : 'waiting_dependencies',
    title: taskTitle(node),
    specification: taskSpecification(node),
    dependencies: upstreamTaskIds(node.id, plan, taskIds),
    inputArtifacts: 'inputs' in node ? [...node.inputs] : [...inputArtifacts],
    outputContracts: taskOutputs(node),
    recommendedRoleProfileIds: node.recommendedRoleProfileIds,
    allowedRoleProfileIds: node.allowedRoleProfileIds
  }
}

function upstreamTaskIds(
  nodeId: string,
  plan: WorkflowExecutionPlan,
  taskIds: ReadonlyMap<string, string>
): string[] {
  const incoming = new Map<string, string[]>()
  for (const edge of plan.edges.filter((candidate) => candidate.maxTraversals === undefined)) {
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from])
  }
  const result = new Set<string>()
  const pending = [...(incoming.get(nodeId) ?? [])]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()!
    if (visited.has(current)) continue
    visited.add(current)
    const taskId = taskIds.get(current)
    if (taskId) result.add(taskId)
    pending.push(...(incoming.get(current) ?? []))
  }
  return [...result].sort()
}

function taskOutputs(
  node: Extract<WorkflowNode, { recommendedRoleProfileIds: string[] }>
): ArtifactContract[] {
  if (node.type === 'role_task') return [...node.outputs]
  if (node.type === 'dynamic_tasks') return [node.planContract]
  if (node.type === 'review_gate') return [node.reportContract]
  return []
}

function taskTitle(node: Extract<WorkflowNode, { recommendedRoleProfileIds: string[] }>): string {
  if (node.type === 'git_merge') return `Merge into ${node.targetBranch}`
  if (node.type === 'review_gate') return `Review ${node.id}`
  if (node.type === 'dynamic_tasks') return `Plan tasks for ${node.id}`
  return node.id
}

function taskSpecification(
  node: Extract<WorkflowNode, { recommendedRoleProfileIds: string[] }>
): string {
  if (node.type === 'role_task') return node.instruction
  if (node.type === 'git_merge') return `Merge approved task commits into ${node.targetBranch}.`
  if (node.type === 'review_gate') return `Review immutable inputs for ${node.id}.`
  return `Produce the dynamic task plan for ${node.id}.`
}

function validateRoleCatalog(
  definition: WorkflowDefinition,
  roleCatalog: readonly RunRoleCatalogEntry[]
): void {
  const keys = roleCatalog.map(roleKey)
  if (new Set(keys).size !== keys.length) {
    throw new WorkflowRunCreationError('duplicate_role_catalog_entry', 'Role catalog is duplicated')
  }
  const catalogIds = new Set(roleCatalog.map((entry) => entry.roleProfileId))
  const referencedIds = definition.nodes.flatMap((node) =>
    'allowedRoleProfileIds' in node
      ? [...node.allowedRoleProfileIds, ...node.recommendedRoleProfileIds]
      : []
  )
  const missing = [...new Set(referencedIds)].filter((id) => !catalogIds.has(id))
  if (missing.length > 0) {
    throw new WorkflowRunCreationError(
      'role_not_in_run_catalog',
      `Workflow references Roles outside the Run catalog: ${missing.join(', ')}`
    )
  }
}

function isRoleNode(
  node: WorkflowNode
): node is Extract<WorkflowNode, { recommendedRoleProfileIds: string[] }> {
  return 'recommendedRoleProfileIds' in node
}

function isStaticTaskNode(
  node: WorkflowNode
): node is Exclude<
  Extract<WorkflowNode, { recommendedRoleProfileIds: string[] }>,
  { type: 'review_gate' | 'git_merge' }
> {
  return isRoleNode(node) && node.type !== 'review_gate' && node.type !== 'git_merge'
}

function stableId(prefix: string, runId: string, nodeId: string, iteration: string): string {
  const digest = createHash('sha256').update(`${runId}\0${nodeId}\0${iteration}`).digest('hex')
  return `${prefix}.${digest.slice(0, 32)}`
}

function roleKey(entry: RunRoleCatalogEntry): string {
  return `${entry.roleProfileId}\0${String(entry.roleProfileVersion).padStart(10, '0')}`
}
