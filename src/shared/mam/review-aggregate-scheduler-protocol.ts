import { z } from 'zod'
import { MamEntityIdSchema } from './domain/primitives'
import { ReviewAggregationSchema } from './domain/review'

export function command<T extends z.ZodRawShape>(taskEnvelope: T) {
  return z
    .object({
      ...taskEnvelope,
      type: z.literal('record_review_aggregate'),
      memberAggregationIds: z.array(MamEntityIdSchema).min(2),
      aggregation: ReviewAggregationSchema
    })
    .strict()
}

export function event<T extends z.ZodRawShape>(eventEnvelope: T) {
  return z
    .object({
      ...eventEnvelope,
      type: z.literal('review_aggregate_recorded'),
      taskId: MamEntityIdSchema,
      memberAggregationIds: z.array(MamEntityIdSchema).min(2),
      aggregation: ReviewAggregationSchema
    })
    .strict()
}
