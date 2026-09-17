import { z } from 'zod'
import { MamEntityIdSchema } from './primitives'

export const ReviewAggregateNodeSchema = z
  .object({
    id: MamEntityIdSchema,
    type: z.literal('review_aggregate'),
    reviewNodeIds: z.array(MamEntityIdSchema).min(2),
    producerNodeId: MamEntityIdSchema,
    revisionTargetNodeId: MamEntityIdSchema,
    totalQuorum: z.number().int().positive(),
    disagreementPolicy: z.literal('human_decision'),
    maxRevisionAttempts: z.number().int().positive().max(20)
  })
  .strict()
