import { z } from 'zod'
import { MamEntityIdSchema } from './domain/primitives'
import { TaskClaimSchema } from './domain/task-claim'

export function createTaskClaimCommandSchemas<T extends z.ZodRawShape>(taskEnvelope: T) {
  return [
    z
      .object({
        ...taskEnvelope,
        type: z.literal('claim_task'),
        claimId: MamEntityIdSchema,
        claimantInstanceId: MamEntityIdSchema
      })
      .strict(),
    z
      .object({
        ...taskEnvelope,
        type: z.literal('release_task_claim'),
        claimId: MamEntityIdSchema,
        generation: z.number().int().positive()
      })
      .strict(),
    z
      .object({
        ...taskEnvelope,
        type: z.literal('force_takeover_task'),
        previousClaimId: MamEntityIdSchema,
        expectedGeneration: z.number().int().positive(),
        newClaimId: MamEntityIdSchema,
        claimantInstanceId: MamEntityIdSchema,
        reason: z.string().trim().min(1).max(4000)
      })
      .strict()
  ] as const
}

export function createTaskClaimEventSchemas<T extends z.ZodRawShape>(eventEnvelope: T) {
  return [
    z
      .object({
        ...eventEnvelope,
        type: z.literal('task_claimed'),
        taskId: MamEntityIdSchema,
        claim: TaskClaimSchema
      })
      .strict(),
    z
      .object({
        ...eventEnvelope,
        type: z.literal('task_claim_released'),
        taskId: MamEntityIdSchema,
        claimId: MamEntityIdSchema,
        generation: z.number().int().positive(),
        releasedByUserId: MamEntityIdSchema
      })
      .strict(),
    z
      .object({
        ...eventEnvelope,
        type: z.literal('task_claim_taken_over'),
        taskId: MamEntityIdSchema,
        previousClaimId: MamEntityIdSchema,
        previousGeneration: z.number().int().positive(),
        claim: TaskClaimSchema,
        reason: z.string().min(1).max(4000),
        takenOverByUserId: MamEntityIdSchema
      })
      .strict()
  ] as const
}
