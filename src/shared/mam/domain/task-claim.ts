import { z } from 'zod'
import { IsoTimestampSchema, MamEntityIdSchema, MamSchemaVersionSchema } from './primitives'

export const TaskClaimSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    claimId: MamEntityIdSchema,
    taskId: MamEntityIdSchema,
    roleProfileId: MamEntityIdSchema,
    roleProfileVersion: z.number().int().positive(),
    claimantInstanceId: MamEntityIdSchema,
    generation: z.number().int().positive(),
    claimedAt: IsoTimestampSchema
  })
  .strict()

export type TaskClaim = z.infer<typeof TaskClaimSchema>
