import { z } from 'zod'
import { AttemptResultSchema } from './domain/attempt-result'
import { ArtifactContractSchema, ArtifactRefSchema } from './domain/artifact'
import {
  MergeConflictResolutionSchema,
  MergeConflictTaskDefinitionSchema
} from './domain/merge-conflict-task'
import { MergeQueueEntrySchema } from './domain/merge-queue'
import {
  IsoTimestampSchema,
  MamEntityIdSchema,
  MamSchemaVersionSchema,
  Sha256Schema
} from './domain/primitives'
import {
  ReviewAggregationSchema,
  ReviewDecisionSchema,
  ReviewDisagreementResolutionSchema,
  ReviewSubjectSchema
} from './domain/review'
import { RoleProfileSchema } from './domain/role'
import {
  ExecutorProfileSchema,
  ModelProfileSchema,
  ProviderProfileSchema
} from './domain/execution-profile'
import { KnowledgeBaseProfileSchema, McpServerProfileSchema } from './domain/resource-profile'
import { MamSkillDefinitionSchema } from './domain/skill-definition'
import { MamLocalSettingsSchema } from './local-settings'
import { NodeRunSchema, WorkflowDefinitionSchema, WorkflowRunSchema } from './domain/workflow'

export const MamUiTaskSnapshotSchema = z
  .object({
    id: MamEntityIdSchema,
    title: z.string().min(1),
    specification: z.string().min(1).optional(),
    inputArtifacts: z.array(ArtifactRefSchema).optional(),
    outputContracts: z.array(ArtifactContractSchema).optional(),
    kind: z.enum(['static', 'dynamic', 'review', 'merge_conflict', 'unknown']),
    status: z.enum([
      'waiting_dependencies',
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
    ]),
    roleProfileId: MamEntityIdSchema.optional(),
    roleProfileVersion: z.number().int().positive().optional(),
    assignedByUserId: MamEntityIdSchema.optional(),
    dependencies: z.array(MamEntityIdSchema),
    recommendedRoleProfileIds: z.array(MamEntityIdSchema),
    allowedRoleProfileIds: z.array(MamEntityIdSchema),
    attemptIds: z.array(MamEntityIdSchema),
    selectedAttemptId: MamEntityIdSchema.optional(),
    reviewSubject: ReviewSubjectSchema.optional(),
    reviewIds: z.array(MamEntityIdSchema),
    executionWarningCount: z.number().int().nonnegative()
  })
  .strict()

export const MamUiAttemptInterruptionSchema = z
  .object({
    stage: z.enum(['executor', 'result_validation', 'artifact_validation']),
    code: z.string().min(1).max(120),
    detail: z.string().min(1).max(500).optional(),
    summary: z.string().min(1).max(500),
    nextStep: z.string().min(1).max(800),
    worktreeRetained: z.boolean()
  })
  .strict()

export const MamUiAttemptSnapshotSchema = z
  .object({
    id: MamEntityIdSchema,
    taskId: MamEntityIdSchema,
    previousAttemptId: MamEntityIdSchema.optional(),
    status: z.enum([
      'recovery_planned',
      'announced',
      'running',
      'submitted',
      'blocked',
      'needs_reconciliation'
    ]),
    roleInstanceId: MamEntityIdSchema.optional(),
    effectiveConfigHash: Sha256Schema.optional(),
    interruption: MamUiAttemptInterruptionSchema.optional(),
    result: AttemptResultSchema.optional()
  })
  .strict()

export const MamUiRunSnapshotSchema = z
  .object({
    run: WorkflowRunSchema,
    definitionName: z.string().min(1),
    roleProfiles: z.array(RoleProfileSchema),
    revision: Sha256Schema,
    stateHash: Sha256Schema,
    nodeRuns: z.array(NodeRunSchema),
    readyTaskIds: z.array(MamEntityIdSchema),
    approvalGates: z
      .array(
        z
          .object({
            id: MamEntityIdSchema,
            prompt: z.string().min(1),
            options: z.array(z.string().min(1)),
            status: z.enum(['pending', 'resolved']),
            selectedOption: z.string().min(1).optional()
          })
          .strict()
      )
      .optional(),
    tasks: z.array(MamUiTaskSnapshotSchema),
    attempts: z.array(MamUiAttemptSnapshotSchema),
    reviews: z.array(ReviewDecisionSchema),
    reviewAggregations: z.array(ReviewAggregationSchema),
    reviewDisagreementResolutions: z.array(ReviewDisagreementResolutionSchema),
    mergeQueueEntries: z.array(MergeQueueEntrySchema),
    mergeConflictTasks: z.array(MergeConflictTaskDefinitionSchema),
    mergeConflictResolutions: z.array(MergeConflictResolutionSchema)
  })
  .strict()

export const MamUiSnapshotSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    generatedAt: IsoTimestampSchema,
    roles: z.array(RoleProfileSchema),
    executors: z.array(ExecutorProfileSchema),
    providers: z.array(ProviderProfileSchema),
    models: z.array(ModelProfileSchema),
    skills: z.array(MamSkillDefinitionSchema),
    mcpServers: z.array(McpServerProfileSchema),
    knowledgeBases: z.array(KnowledgeBaseProfileSchema),
    workflows: z.array(WorkflowDefinitionSchema),
    localSettings: MamLocalSettingsSchema,
    projectBinding: z
      .object({
        projectDirectory: z.string().min(1),
        stateDirectory: z.string().min(1),
        collaborationMode: z.enum(['local', 'distributed']),
        remote: z.string().min(1).optional(),
        branch: z.string().min(1)
      })
      .strict()
      .optional(),
    runs: z.array(MamUiRunSnapshotSchema),
    issues: z.array(
      z
        .object({
          code: z.string().min(1),
          workflowRunId: MamEntityIdSchema.optional(),
          message: z.string().min(1)
        })
        .strict()
    )
  })
  .strict()

export type MamUiSnapshot = z.infer<typeof MamUiSnapshotSchema>
export type MamUiRunSnapshot = z.infer<typeof MamUiRunSnapshotSchema>
