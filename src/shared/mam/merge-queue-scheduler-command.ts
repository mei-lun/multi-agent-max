import { z } from 'zod'
import { MergeOutcomeSchema, MergeQueueEntrySchema } from './domain/merge-queue'
import { MergeConflictResolutionSchema } from './domain/merge-conflict-task'
import { IsoTimestampSchema, MamEntityIdSchema } from './domain/primitives'

export function createMergeQueueCommandSchemas<
  CommandEnvelope extends z.ZodRawShape,
  TaskCommandEnvelope extends z.ZodRawShape
>(commandEnvelope: CommandEnvelope, taskCommandEnvelope: TaskCommandEnvelope) {
  return [
    z
      .object({
        ...taskCommandEnvelope,
        type: z.literal('mark_merge_ready'),
        entry: MergeQueueEntrySchema
      })
      .strict(),
    z
      .object({
        ...taskCommandEnvelope,
        type: z.literal('record_merge_conflict_resolution'),
        attemptId: MamEntityIdSchema,
        resolution: MergeConflictResolutionSchema
      })
      .strict(),
    z
      .object({
        ...commandEnvelope,
        type: z.literal('claim_merge_entry'),
        entryId: MamEntityIdSchema,
        claimedAt: IsoTimestampSchema
      })
      .strict(),
    z
      .object({
        ...commandEnvelope,
        type: z.literal('record_merge_outcome'),
        entryId: MamEntityIdSchema,
        outcome: MergeOutcomeSchema
      })
      .strict(),
    z
      .object({
        ...commandEnvelope,
        type: z.literal('supersede_merge_entry'),
        entryId: MamEntityIdSchema,
        replacementCommit: z.string().min(7),
        supersededAt: IsoTimestampSchema
      })
      .strict()
  ] as const
}
