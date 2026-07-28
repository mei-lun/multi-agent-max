import { z } from 'zod'
import { MamEntityIdSchema } from './domain/primitives'

export const MamGetAttemptDiffInputSchema = z
  .object({
    workflowRunId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema
  })
  .strict()

export const MamAttemptDiffSchema = z
  .object({
    attemptId: MamEntityIdSchema,
    submittedCommit: z.string().min(7),
    diff: z.string(),
    truncated: z.boolean()
  })
  .strict()

export type MamGetAttemptDiffInput = z.infer<typeof MamGetAttemptDiffInputSchema>
export type MamAttemptDiff = z.infer<typeof MamAttemptDiffSchema>
