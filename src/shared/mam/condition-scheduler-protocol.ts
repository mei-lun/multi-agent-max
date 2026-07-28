import { z } from 'zod'
import { MamEntityIdSchema } from './domain/primitives'

export function createConditionCommandSchema<T extends z.ZodRawShape>(commandEnvelope: T) {
  return z
    .object({
      ...commandEnvelope,
      type: z.literal('resolve_condition'),
      nodeId: MamEntityIdSchema,
      selectedBranch: z.string().min(1).max(1000)
    })
    .strict()
}

export function createConditionEventSchema<T extends z.ZodRawShape>(eventEnvelope: T) {
  return z
    .object({
      ...eventEnvelope,
      type: z.literal('condition_resolved'),
      nodeId: MamEntityIdSchema,
      selectedBranch: z.string().min(1)
    })
    .strict()
}
