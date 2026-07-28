import { z } from 'zod'
import { ArtifactContractSchema, ArtifactRefSchema } from './artifact'
import {
  IsoTimestampSchema,
  MamEntityIdSchema,
  MamSchemaVersionSchema,
  Sha256Schema
} from './primitives'

export const TaskAssignmentSchema = z
  .object({
    taskId: MamEntityIdSchema,
    roleProfileId: MamEntityIdSchema,
    roleProfileVersion: z.number().int().positive(),
    assignedByUserId: MamEntityIdSchema,
    assignmentCommandId: MamEntityIdSchema,
    assignedAt: IsoTimestampSchema
  })
  .strict()

export const ExecutionClaimNoticeSchema = z
  .object({
    claimId: MamEntityIdSchema,
    workflowRunId: MamEntityIdSchema,
    taskId: MamEntityIdSchema,
    roleProfileId: MamEntityIdSchema,
    executorInstanceId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    announcedAt: IsoTimestampSchema,
    lastObservedAt: IsoTimestampSchema.optional(),
    releasedAt: IsoTimestampSchema.optional(),
    revision: z.string().min(1)
  })
  .strict()

export const GitChangeSchema = z
  .object({
    repositoryId: MamEntityIdSchema,
    baseBranch: z.string().min(1),
    baseCommit: z.string().min(7),
    taskBranch: z.string().min(1),
    submittedCommit: z.string().min(7).optional(),
    mergeReadyAt: IsoTimestampSchema.optional()
  })
  .strict()

export const AttemptSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    taskId: MamEntityIdSchema,
    number: z.number().int().positive(),
    previousAttemptId: MamEntityIdSchema.optional(),
    roleInstanceId: MamEntityIdSchema.optional(),
    effectiveConfigSnapshotId: MamEntityIdSchema,
    effectiveConfigHash: Sha256Schema,
    resultHash: Sha256Schema.optional(),
    status: z.enum([
      'created',
      'running',
      'validating_output',
      'submitted',
      'changes_requested',
      'completed',
      'failed',
      'blocked',
      'needs_reconciliation'
    ]),
    outputArtifacts: z.array(ArtifactRefSchema),
    gitChange: GitChangeSchema.optional(),
    createdAt: IsoTimestampSchema,
    completedAt: IsoTimestampSchema.optional()
  })
  .strict()

export const TaskSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    workflowRunId: MamEntityIdSchema,
    nodeRunId: MamEntityIdSchema,
    title: z.string().min(1).max(240),
    specification: z.string().min(1),
    dependencies: z.array(MamEntityIdSchema),
    inputArtifacts: z.array(ArtifactRefSchema),
    outputContracts: z.array(ArtifactContractSchema),
    recommendedRoleProfileIds: z.array(MamEntityIdSchema),
    allowedRoleProfileIds: z.array(MamEntityIdSchema),
    assignment: TaskAssignmentSchema.optional(),
    executionNotices: z.array(ExecutionClaimNoticeSchema),
    attemptIds: z.array(MamEntityIdSchema),
    selectedAttemptId: MamEntityIdSchema.optional(),
    status: z.enum([
      'waiting_role_assignment',
      'ready',
      'running',
      'submitted',
      'in_review',
      'changes_requested',
      'approved',
      'completed',
      'blocked',
      'cancelled',
      'needs_attention'
    ])
  })
  .strict()

export type TaskAssignment = z.infer<typeof TaskAssignmentSchema>
export type ExecutionClaimNotice = z.infer<typeof ExecutionClaimNoticeSchema>
export type Attempt = z.infer<typeof AttemptSchema>
export type Task = z.infer<typeof TaskSchema>
