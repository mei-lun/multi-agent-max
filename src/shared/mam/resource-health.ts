import { z } from 'zod'
import { IsoTimestampSchema, MamEntityIdSchema, Sha256Schema } from './domain/primitives'

export const ResourceHealthResultSchema = z
  .object({
    kind: z.enum(['skill', 'mcp', 'knowledge']),
    resourceId: MamEntityIdSchema,
    version: z.number().int().positive(),
    fingerprint: Sha256Schema,
    status: z.enum(['healthy', 'invalid', 'pi-incompatible']),
    checkedAt: IsoTimestampSchema,
    stage: z.string().min(1).max(120),
    code: z.string().min(1).max(120).optional(),
    message: z.string().min(1).max(500).optional()
  })
  .strict()

export type ResourceHealthResult = z.infer<typeof ResourceHealthResultSchema>
