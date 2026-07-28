import { z } from 'zod'
import { ArtifactContractSchema, ArtifactRefSchema } from './artifact'
import {
  IsoTimestampSchema,
  MamEntityIdSchema,
  MamSchemaVersionSchema,
  Sha256Schema
} from './primitives'
import { WorkflowDefinitionSchema, WorkflowRunSchema } from './workflow'
import { RoleProfileSchema } from './role'

export const ExecutionPlanNodeSchema = z
  .object({
    id: MamEntityIdSchema,
    type: z.enum([
      'role_task',
      'dynamic_tasks',
      'review_gate',
      'approval_gate',
      'condition',
      'parallel',
      'join',
      'artifact_transform',
      'command',
      'git_merge',
      'finish'
    ]),
    ordinal: z.number().int().nonnegative(),
    dependencies: z.array(MamEntityIdSchema),
    successors: z.array(MamEntityIdSchema),
    requiredArtifacts: z.array(MamEntityIdSchema),
    producedArtifacts: z.array(MamEntityIdSchema)
  })
  .strict()

export const WorkflowExecutionPlanSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    definitionId: MamEntityIdSchema,
    definitionVersion: z.number().int().positive(),
    planHash: Sha256Schema,
    nodes: z.array(ExecutionPlanNodeSchema).min(1),
    edges: z.array(
      z
        .object({
          from: MamEntityIdSchema,
          to: MamEntityIdSchema,
          when: z.string().min(1).optional(),
          maxTraversals: z.number().int().positive().optional()
        })
        .strict()
    ),
    inputArtifacts: z.array(ArtifactRefSchema),
    maxTransitions: z.number().int().positive(),
    maxRunCostUsd: z.number().nonnegative(),
    maxRunDurationSeconds: z.number().int().positive()
  })
  .strict()

export const StaticTaskDefinitionSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    workflowRunId: MamEntityIdSchema,
    nodeRunId: MamEntityIdSchema,
    nodeId: MamEntityIdSchema,
    nodeType: z.enum(['role_task', 'dynamic_tasks', 'review_gate', 'git_merge']),
    iteration: z.number().int().positive(),
    initialStatus: z.enum(['waiting_dependencies', 'waiting_role_assignment']),
    title: z.string().min(1).max(240),
    specification: z.string().min(1),
    dependencies: z.array(MamEntityIdSchema),
    inputArtifacts: z.array(ArtifactRefSchema),
    outputContracts: z.array(ArtifactContractSchema),
    recommendedRoleProfileIds: z.array(MamEntityIdSchema),
    allowedRoleProfileIds: z.array(MamEntityIdSchema)
  })
  .strict()

export const WorkflowRunBundleSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    run: WorkflowRunSchema,
    definition: WorkflowDefinitionSchema,
    plan: WorkflowExecutionPlanSchema,
    roleCatalogHash: Sha256Schema,
    roleProfiles: z.array(RoleProfileSchema).optional(),
    taskCatalog: z.array(StaticTaskDefinitionSchema),
    bundleHash: Sha256Schema,
    createdAt: IsoTimestampSchema
  })
  .strict()
  .superRefine((bundle, context) => {
    if (bundle.taskCatalog.some((task) => bundle.run.id !== task.workflowRunId)) {
      context.addIssue({
        code: 'custom',
        path: ['taskCatalog'],
        message: 'task targets another run'
      })
    }
    if (
      bundle.run.definitionId !== bundle.definition.id ||
      bundle.run.definitionVersion !== bundle.definition.version ||
      bundle.run.planHash !== bundle.plan.planHash
    ) {
      context.addIssue({ code: 'custom', path: ['run'], message: 'run bundle identity mismatch' })
    }
    const nodeIds = new Set(bundle.definition.nodes.map((node) => node.id))
    if (bundle.taskCatalog.some((task) => !nodeIds.has(task.nodeId))) {
      context.addIssue({ code: 'custom', path: ['taskCatalog'], message: 'task node is unknown' })
    }
    for (const role of bundle.roleProfiles ?? []) {
      const entry = bundle.run.roleCatalog.find(
        (candidate) =>
          candidate.roleProfileId === role.id && candidate.roleProfileVersion === role.version
      )
      if (!entry) {
        context.addIssue({
          code: 'custom',
          path: ['roleProfiles'],
          message: 'frozen Role is outside the Run catalog'
        })
      }
    }
  })

export type ExecutionPlanNode = z.infer<typeof ExecutionPlanNodeSchema>
export type WorkflowExecutionPlan = z.infer<typeof WorkflowExecutionPlanSchema>
export type StaticTaskDefinition = z.infer<typeof StaticTaskDefinitionSchema>
export type WorkflowRunBundle = z.infer<typeof WorkflowRunBundleSchema>
