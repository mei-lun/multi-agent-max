import { z } from 'zod'
import {
  IsoTimestampSchema,
  MamEntityIdSchema,
  MamSchemaVersionSchema,
  Sha256Schema
} from './domain/primitives'
import {
  ExecutorProfileSchema,
  LocalExecutorBindingSchema
} from './domain/execution-profile'
import { EffectiveRoleConfigSnapshotSchema } from './domain/role'
import { MamLocalSkillBindingSchema, MamSkillDefinitionSchema } from './domain/skill-definition'
import {
  KnowledgeBaseProfileSchema,
  LocalKnowledgeBindingSchema,
  McpServerProfileSchema,
  RoleKnowledgeBaseBindingSchema,
  RoleMcpBindingSchema
} from './domain/resource-profile'

const FrozenResolvedAttemptConfigSchema = z
  .object({
    snapshot: EffectiveRoleConfigSnapshotSchema,
    skills: z.array(
      z.object({ definition: MamSkillDefinitionSchema, localBinding: MamLocalSkillBindingSchema })
    ),
    mcpResources: z.array(
      z.object({ binding: RoleMcpBindingSchema, profile: McpServerProfileSchema })
    ),
    knowledgeResources: z.array(
      z.object({
        binding: RoleKnowledgeBaseBindingSchema,
        profile: KnowledgeBaseProfileSchema,
        localBinding: LocalKnowledgeBindingSchema.optional(),
        status: z.enum(['available', 'degraded'])
      })
    )
  })
  .strict()

const FrozenMaterializedResourcesSchema = z
  .object({
    attemptId: MamEntityIdSchema,
    rootDirectory: z.string().min(1),
    configPath: z.string().min(1),
    manifestPath: z.string().min(1),
    skillDirectories: z.record(z.string(), z.string()),
    contentHash: Sha256Schema
  })
  .strict()

export const FrozenExecutionContextSchema = z
  .object({
    profile: ExecutorProfileSchema,
    binding: LocalExecutorBindingSchema,
    resolvedConfig: FrozenResolvedAttemptConfigSchema,
    resources: FrozenMaterializedResourcesSchema
  })
  .strict()

export const LocalExecutionDraftSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    workflowRunId: MamEntityIdSchema,
    taskId: MamEntityIdSchema,
    claimId: MamEntityIdSchema,
    claimGeneration: z.number().int().positive(),
    attemptId: MamEntityIdSchema,
    previousDeliveredAttemptId: MamEntityIdSchema.optional(),
    formalRevisionNumber: z.number().int().nonnegative(),
    roleInstanceId: MamEntityIdSchema,
    executorInvocationId: MamEntityIdSchema,
    effectiveConfigSnapshotId: MamEntityIdSchema,
    effectiveConfigHash: Sha256Schema,
    executorKind: z.enum(['codex-cli', 'grok-cli', 'pi-rpc']),
    invocationDirectory: z.string().min(1),
    sessionDirectory: z.string().min(1),
    worktreePath: z.string().min(1),
    worktreeBranch: z.string().min(1),
    baseCommit: z.string().min(7),
    state: z.enum([
      'preparing',
      'running',
      'waiting_for_resume',
      'needs_attention',
      'validating',
      'ready_to_deliver',
      'delivered',
      'discarded',
      'stale_claim'
    ]),
    frozenExecution: FrozenExecutionContextSchema.optional(),
    activeRuntimeMs: z.number().int().nonnegative(),
    activeStartedAt: IsoTimestampSchema.optional(),
    lastErrorCode: z.string().min(1).max(120).optional(),
    lastErrorAt: IsoTimestampSchema.optional(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema
  })
  .strict()

export type LocalExecutionDraft = z.infer<typeof LocalExecutionDraftSchema>
export type FrozenExecutionContext = z.infer<typeof FrozenExecutionContextSchema>
