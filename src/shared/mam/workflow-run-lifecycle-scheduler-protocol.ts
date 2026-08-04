import { z } from 'zod'
import { MamEntityIdSchema, Sha256Schema } from './domain/primitives'

export function createWorkflowRunLifecycleCommandSchemas<T extends z.ZodRawShape>(
  commandEnvelope: T
) {
  return [
    z
      .object({
        ...commandEnvelope,
        type: z.literal('create_workflow_run'),
        definitionId: MamEntityIdSchema,
        definitionVersion: z.number().int().positive(),
        planHash: Sha256Schema,
        roleCatalogHash: Sha256Schema
      })
      .strict(),
    z
      .object({
        ...commandEnvelope,
        type: z.literal('cancel_workflow_run'),
        reason: z.string().min(1).max(4000)
      })
      .strict()
  ] as const
}

export function createWorkflowRunLifecycleEventSchemas<T extends z.ZodRawShape>(eventEnvelope: T) {
  return [
    z
      .object({
        ...eventEnvelope,
        type: z.literal('workflow_run_created'),
        definitionId: MamEntityIdSchema,
        definitionVersion: z.number().int().positive(),
        planHash: Sha256Schema,
        roleCatalogHash: Sha256Schema
      })
      .strict(),
    z
      .object({
        ...eventEnvelope,
        type: z.literal('workflow_run_cancelled'),
        userId: MamEntityIdSchema,
        reason: z.string().min(1).max(4000)
      })
      .strict()
  ] as const
}
