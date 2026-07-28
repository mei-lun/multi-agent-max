import { z } from 'zod'
import {
  IsoTimestampSchema,
  MamEntityIdSchema,
  MamSchemaVersionSchema,
  Sha256Schema
} from './primitives'
import { MergeConflictTaskDefinitionSchema } from './merge-conflict-task'

export const MergeQueueEntrySchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    workflowRunId: MamEntityIdSchema,
    mergeNodeId: MamEntityIdSchema,
    taskId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    targetBranch: z.string().min(1),
    sourceBranch: z.string().min(1),
    submittedCommit: z.string().min(7),
    resultHash: Sha256Schema,
    mergeReadyAt: IsoTimestampSchema,
    readyRevisionHash: Sha256Schema,
    reviewDecisionIds: z.array(MamEntityIdSchema).min(1),
    validationEvidence: z.record(z.string(), Sha256Schema),
    strategy: z.enum(['no_ff', 'ff_only']),
    conflictPolicy: z.literal('coordinator_attempt'),
    status: z.enum(['queued', 'merging', 'conflict', 'merged', 'superseded', 'failed']),
    claimedAt: IsoTimestampSchema.optional(),
    detectedAt: IsoTimestampSchema.optional(),
    completedAt: IsoTimestampSchema.optional(),
    mergeCommit: z.string().min(7).optional(),
    conflictTaskId: MamEntityIdSchema.optional(),
    resolutionAttemptId: MamEntityIdSchema.optional(),
    supersededByCommit: z.string().min(7).optional(),
    supersededAt: IsoTimestampSchema.optional(),
    failureReason: z.string().min(1).max(4000).optional()
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.status === 'merging' && !entry.claimedAt) {
      context.addIssue({ code: 'custom', message: 'merging entry requires claimedAt' })
    }
    if (entry.status === 'conflict' && (!entry.conflictTaskId || !entry.detectedAt)) {
      context.addIssue({ code: 'custom', message: 'conflict entry requires conflict evidence' })
    }
    if (entry.status === 'merged' && (!entry.completedAt || !entry.mergeCommit)) {
      context.addIssue({ code: 'custom', message: 'merged entry requires completion evidence' })
    }
    if (entry.status === 'superseded' && (!entry.supersededByCommit || !entry.supersededAt)) {
      context.addIssue({
        code: 'custom',
        message: 'superseded entry requires replacement evidence'
      })
    }
    if (entry.status === 'failed' && (!entry.completedAt || !entry.failureReason)) {
      context.addIssue({ code: 'custom', message: 'failed entry requires failure evidence' })
    }
  })

export type MergeQueueEntry = z.infer<typeof MergeQueueEntrySchema>

export const MergeOutcomeSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('merged'),
      mergeCommit: z.string().min(7),
      completedAt: IsoTimestampSchema
    })
    .strict(),
  z
    .object({
      status: z.literal('conflict'),
      conflictTask: MergeConflictTaskDefinitionSchema
    })
    .strict(),
  z
    .object({
      status: z.literal('failed'),
      reason: z.string().min(1).max(4000),
      completedAt: IsoTimestampSchema
    })
    .strict()
])

export type MergeOutcome = z.infer<typeof MergeOutcomeSchema>
