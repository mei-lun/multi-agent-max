import { z } from 'zod'
import { ArtifactContractSchema, ArtifactRefSchema } from './artifact'
import {
  IsoTimestampSchema,
  MamEntityIdSchema,
  MamSchemaVersionSchema,
  Sha256Schema
} from './primitives'
import { validateHumanReviewWorkflow } from './human-review-workflow-validation'
import { containsWorkflowCycle } from './workflow-cycle-detection'

const roleSelection = {
  recommendedRoleProfileIds: z.array(MamEntityIdSchema).length(1),
  allowedRoleProfileIds: z.array(MamEntityIdSchema).length(1)
}

const roleTaskNode = z
  .object({
    id: MamEntityIdSchema,
    type: z.literal('role_task'),
    ...roleSelection,
    instruction: z.string().min(1).max(20_000),
    workspaceMode: z.enum(['none', 'read', 'write']),
    inputs: z.array(ArtifactRefSchema),
    outputs: z.array(ArtifactContractSchema).min(1)
  })
  .strict()

const dynamicTasksNode = z
  .object({
    id: MamEntityIdSchema,
    type: z.literal('dynamic_tasks'),
    ...roleSelection,
    planContract: ArtifactContractSchema,
    maxTasks: z.number().int().positive().max(200)
  })
  .strict()

const reviewGateNode = z
  .object({
    id: MamEntityIdSchema,
    type: z.literal('review_gate'),
    ...roleSelection,
    inputs: z.array(ArtifactRefSchema).min(1),
    reportContract: ArtifactContractSchema,
    minimumDecisions: z.number().int().positive(),
    maxRevisionAttempts: z.number().int().positive().max(20)
  })
  .strict()

const approvalGateNode = z
  .object({
    id: MamEntityIdSchema,
    type: z.literal('approval_gate'),
    prompt: z.string().min(1),
    options: z.array(z.string().min(1)).min(1)
  })
  .strict()

const humanReviewGateNode = z
  .object({
    id: MamEntityIdSchema,
    type: z.literal('human_review_gate'),
    inputs: z.array(ArtifactRefSchema).min(1),
    instructions: z.string().min(1).max(20_000),
    revisionTargetNodeId: MamEntityIdSchema,
    maxRevisionAttempts: z.number().int().positive().max(20)
  })
  .strict()

const conditionNode = z
  .object({
    id: MamEntityIdSchema,
    type: z.literal('condition'),
    expression: z.string().min(1),
    branches: z.record(z.string(), MamEntityIdSchema)
  })
  .strict()

const parallelNode = z
  .object({
    id: MamEntityIdSchema,
    type: z.literal('parallel'),
    branches: z.array(MamEntityIdSchema).min(2)
  })
  .strict()

const joinNode = z
  .object({
    id: MamEntityIdSchema,
    type: z.literal('join'),
    waitFor: z.array(MamEntityIdSchema).min(2)
  })
  .strict()

const artifactTransformNode = z
  .object({
    id: MamEntityIdSchema,
    type: z.literal('artifact_transform'),
    inputs: z.array(ArtifactRefSchema).min(1),
    outputs: z.array(ArtifactContractSchema).min(1),
    transform: z.string().min(1)
  })
  .strict()

const commandNode = z
  .object({
    id: MamEntityIdSchema,
    type: z.literal('command'),
    executable: z.string().min(1),
    arguments: z.array(z.string()),
    workingDirectory: z.string().min(1),
    outputs: z.array(ArtifactContractSchema)
  })
  .strict()

const gitMergeNode = z
  .object({
    id: MamEntityIdSchema,
    type: z.literal('git_merge'),
    ...roleSelection,
    targetBranch: z.string().min(1),
    orderBy: z.literal('merge_ready_at'),
    strategy: z.enum(['no_ff', 'ff_only']),
    conflictPolicy: z.literal('coordinator_attempt'),
    validations: z.array(z.string().min(1))
  })
  .strict()

const finishNode = z
  .object({
    id: MamEntityIdSchema,
    type: z.literal('finish'),
    inputs: z.array(ArtifactRefSchema)
  })
  .strict()

export const WorkflowNodeSchema = z.discriminatedUnion('type', [
  roleTaskNode,
  dynamicTasksNode,
  reviewGateNode,
  approvalGateNode,
  humanReviewGateNode,
  conditionNode,
  parallelNode,
  joinNode,
  artifactTransformNode,
  commandNode,
  gitMergeNode,
  finishNode
])

export const WorkflowEdgeSchema = z
  .object({
    from: MamEntityIdSchema,
    to: MamEntityIdSchema,
    when: z.string().min(1).optional(),
    maxTraversals: z.number().int().positive().max(100).optional()
  })
  .strict()

export const WorkflowDefinitionSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    name: z.string().min(1).max(160),
    version: z.number().int().positive(),
    nodes: z.array(WorkflowNodeSchema).min(1),
    edges: z.array(WorkflowEdgeSchema),
    maxTransitions: z.number().int().positive().max(10_000),
    maxRunCostUsd: z.number().nonnegative(),
    maxRunDurationSeconds: z.number().int().positive()
  })
  .strict()
  .superRefine(validateWorkflowGraph)

export const NodeRunSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    nodeId: MamEntityIdSchema,
    attemptIds: z.array(MamEntityIdSchema),
    latestAttemptId: MamEntityIdSchema.optional(),
    status: z.enum([
      'created',
      'waiting_dependencies',
      'waiting_role_assignment',
      'waiting_for_approval',
      'waiting_for_human_input',
      'resuming',
      'ready',
      'running',
      'validating_output',
      'submitted',
      'in_review',
      'approved',
      'changes_requested',
      'passed',
      'failed',
      'blocked',
      'cancelled'
    ]),
    startedAt: IsoTimestampSchema.optional(),
    completedAt: IsoTimestampSchema.optional()
  })
  .strict()

export const RunRoleCatalogEntrySchema = z
  .object({
    roleProfileId: MamEntityIdSchema,
    roleProfileVersion: z.number().int().positive(),
    contentHash: Sha256Schema
  })
  .strict()

export const WorkflowRunSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    definitionId: MamEntityIdSchema,
    definitionVersion: z.number().int().positive(),
    planHash: Sha256Schema,
    roleCatalog: z.array(RunRoleCatalogEntrySchema),
    stateBackend: z.literal('git'),
    status: z.enum([
      'created',
      'running',
      'waiting_for_approval',
      'awaiting_human_decision',
      'blocked',
      'completed',
      'cancelled'
    ]),
    nodeRuns: z.array(NodeRunSchema),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema
  })
  .strict()

function validateWorkflowGraph(
  definition: {
    nodes: {
      id: string
      type: string
      recommendedRoleProfileIds?: string[]
      allowedRoleProfileIds?: string[]
      revisionTargetNodeId?: string | undefined
      maxRevisionAttempts?: number | undefined
    }[]
    edges: {
      from: string
      to: string
      when?: string | undefined
      maxTraversals?: number | undefined
    }[]
  },
  context: z.RefinementCtx
): void {
  for (const node of definition.nodes) {
    if (
      node.allowedRoleProfileIds &&
      node.recommendedRoleProfileIds &&
      node.allowedRoleProfileIds[0] !== node.recommendedRoleProfileIds[0]
    ) {
      context.addIssue({
        code: 'custom',
        path: ['nodes'],
        message: `node ${node.id} must bind one fixed Role`
      })
    }
  }
  const nodeIds = new Set<string>()
  for (const node of definition.nodes) {
    if (nodeIds.has(node.id)) {
      context.addIssue({
        code: 'custom',
        path: ['nodes'],
        message: `duplicate node id: ${node.id}`
      })
    }
    nodeIds.add(node.id)
  }
  if (!definition.nodes.some((node) => node.type === 'finish')) {
    context.addIssue({
      code: 'custom',
      path: ['nodes'],
      message: 'workflow requires a finish node'
    })
  }
  validateHumanReviewWorkflow(definition, context)
  const unboundedEdges = definition.edges.filter((edge) => {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      context.addIssue({
        code: 'custom',
        path: ['edges'],
        message: `edge references unknown node: ${edge.from} -> ${edge.to}`
      })
      return false
    }
    return edge.maxTraversals === undefined
  })
  if (containsWorkflowCycle(nodeIds, unboundedEdges)) {
    context.addIssue({
      code: 'custom',
      path: ['edges'],
      message: 'workflow contains an unbounded cycle; every cycle requires maxTraversals'
    })
  }
}

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>
export type NodeRun = z.infer<typeof NodeRunSchema>
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>
export type RunRoleCatalogEntry = z.infer<typeof RunRoleCatalogEntrySchema>
