import { z } from 'zod'
import { ArtifactContractSchema, ArtifactRefSchema } from './artifact'
import {
  IsoTimestampSchema,
  MamEntityIdSchema,
  MamSchemaVersionSchema,
  Sha256Schema
} from './primitives'

export const TaskPlanItemSchema = z
  .object({
    id: MamEntityIdSchema,
    title: z.string().min(1).max(240),
    specification: z.string().min(1).max(20_000),
    dependencies: z.array(MamEntityIdSchema),
    inputArtifacts: z.array(ArtifactRefSchema),
    outputContracts: z.array(ArtifactContractSchema).min(1),
    recommendedRoleProfileIds: z.array(MamEntityIdSchema).length(1),
    allowedRoleProfileIds: z.array(MamEntityIdSchema).length(1)
  })
  .strict()

export const TaskPlanSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    workflowRunId: MamEntityIdSchema,
    nodeRunId: MamEntityIdSchema,
    sourceTaskId: MamEntityIdSchema,
    sourceAttemptId: MamEntityIdSchema,
    tasks: z.array(TaskPlanItemSchema).min(1).max(200),
    createdAt: IsoTimestampSchema
  })
  .strict()

export const DynamicTaskDefinitionSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    workflowRunId: MamEntityIdSchema,
    nodeRunId: MamEntityIdSchema,
    nodeId: MamEntityIdSchema,
    parentTaskId: MamEntityIdSchema,
    sourceAttemptId: MamEntityIdSchema,
    taskPlanId: MamEntityIdSchema,
    taskPlanHash: Sha256Schema,
    planItemId: MamEntityIdSchema,
    initialStatus: z.enum(['waiting_dependencies', 'waiting_role_assignment']),
    title: z.string().min(1).max(240),
    specification: z.string().min(1).max(20_000),
    dependencies: z.array(MamEntityIdSchema),
    inputArtifacts: z.array(ArtifactRefSchema),
    outputContracts: z.array(ArtifactContractSchema).min(1),
    recommendedRoleProfileIds: z.array(MamEntityIdSchema).length(1),
    allowedRoleProfileIds: z.array(MamEntityIdSchema).length(1)
  })
  .strict()

export type TaskPlanItem = z.infer<typeof TaskPlanItemSchema>
export type TaskPlan = z.infer<typeof TaskPlanSchema>
export type DynamicTaskDefinition = z.infer<typeof DynamicTaskDefinitionSchema>
