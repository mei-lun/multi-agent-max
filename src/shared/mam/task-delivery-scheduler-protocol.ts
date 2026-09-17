import { z } from 'zod'
import { AttemptResultSchema } from './domain/attempt-result'
import { MamEntityIdSchema, Sha256Schema } from './domain/primitives'
import { ReviewDecisionSchema } from './domain/review'

const deliveryFields = {
  claimId: MamEntityIdSchema,
  generation: z.number().int().positive(),
  attemptId: MamEntityIdSchema,
  previousDeliveredAttemptId: MamEntityIdSchema.optional(),
  lineageKind: z.enum(['initial', 'revision', 'recovery']),
  revisionNumber: z.number().int().nonnegative(),
  roleInstanceId: MamEntityIdSchema,
  executorInvocationId: MamEntityIdSchema,
  effectiveConfigSnapshotId: MamEntityIdSchema,
  effectiveConfigHash: Sha256Schema,
  result: AttemptResultSchema,
  inputDeliveries: z.array(
    z.object({ taskId: MamEntityIdSchema, attemptId: MamEntityIdSchema }).strict()
  ),
  review: ReviewDecisionSchema.optional()
}

export function createTaskDeliveryCommandSchema<T extends z.ZodRawShape>(taskEnvelope: T) {
  return z
    .object({ ...taskEnvelope, type: z.literal('record_task_delivery'), ...deliveryFields })
    .strict()
}

export function createTaskDeliveryEventSchema<T extends z.ZodRawShape>(eventEnvelope: T) {
  return z
    .object({
      ...eventEnvelope,
      type: z.literal('task_delivery_recorded'),
      taskId: MamEntityIdSchema,
      ...deliveryFields
    })
    .strict()
}
