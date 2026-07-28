import { z } from 'zod'
import {
  IsoTimestampSchema,
  MamEntityIdSchema,
  MamSchemaVersionSchema,
  Sha256Schema
} from './primitives'

export const MergeConflictTaskDefinitionSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    workflowRunId: MamEntityIdSchema,
    mergeNodeId: MamEntityIdSchema,
    queueEntryId: MamEntityIdSchema,
    parentTaskId: MamEntityIdSchema,
    parentAttemptId: MamEntityIdSchema,
    targetBranch: z.string().min(1),
    sourceBranch: z.string().min(1),
    targetCommit: z.string().min(7),
    submittedCommit: z.string().min(7),
    mergeBase: z.string().min(7),
    conflictingPaths: z.array(z.string().min(1)).min(1),
    validationCommands: z.array(z.string().min(1)),
    recommendedRoleProfileIds: z.array(MamEntityIdSchema),
    allowedRoleProfileIds: z.array(MamEntityIdSchema),
    initialStatus: z.literal('waiting_role_assignment'),
    createdAt: IsoTimestampSchema
  })
  .strict()

export type MergeConflictTaskDefinition = z.infer<typeof MergeConflictTaskDefinitionSchema>

export const MergeConflictResolutionSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    workflowRunId: MamEntityIdSchema,
    queueEntryId: MamEntityIdSchema,
    conflictTaskId: MamEntityIdSchema,
    resolutionAttemptId: MamEntityIdSchema,
    mergeCommit: z.string().min(7),
    validationEvidence: z.record(z.string(), Sha256Schema),
    completedAt: IsoTimestampSchema
  })
  .strict()

export type MergeConflictResolution = z.infer<typeof MergeConflictResolutionSchema>
