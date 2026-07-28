import { z } from 'zod'
import {
  ExecutorKindSchema,
  InferenceOptionsSchema,
  ModelCapabilitiesSchema,
  ProviderProtocolSchema,
  ResolvedProfileRefSchema,
  RoleExecutionBindingSchema
} from './execution-profile'
import {
  IsoTimestampSchema,
  MamEntityIdSchema,
  MamSchemaVersionSchema,
  Sha256Schema
} from './primitives'
import {
  ResolvedKnowledgeBindingSchema,
  ResolvedMcpBindingSchema,
  ResolvedSkillSchema,
  RoleKnowledgeBaseBindingSchema,
  RoleMcpBindingSchema,
  RoleSkillBindingSchema
} from './resource-profile'

export const PermissionPolicySchema = z
  .object({
    readPaths: z.array(z.string().min(1)),
    writePaths: z.array(z.string().min(1)),
    allowedCommands: z.array(z.string().min(1)),
    deniedCommands: z.array(z.string().min(1)),
    allowedNetworkHosts: z.array(z.string().min(1)),
    requireApprovalFor: z.array(z.enum(['file', 'command', 'network', 'mcp', 'knowledge']))
  })
  .strict()

export const BudgetPolicySchema = z
  .object({
    maxInputTokens: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    maxCostUsd: z.number().nonnegative(),
    maxDurationSeconds: z.number().int().positive()
  })
  .strict()

export const RetryPolicySchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(20),
    initialBackoffMs: z.number().int().nonnegative(),
    maxBackoffMs: z.number().int().nonnegative()
  })
  .strict()

export const ContextPolicySchema = z
  .object({
    maxContextTokens: z.number().int().positive(),
    compaction: z.enum(['disabled', 'executor', 'scheduler']),
    includePreviousAttempts: z.boolean()
  })
  .strict()

export const RoleProfileSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    version: z.number().int().positive(),
    displayName: z.string().min(1).max(120),
    execution: RoleExecutionBindingSchema,
    systemPromptRef: z.string().min(1),
    skillBindings: z.array(RoleSkillBindingSchema),
    mcpBindings: z.array(RoleMcpBindingSchema),
    knowledgeBaseBindings: z.array(RoleKnowledgeBaseBindingSchema),
    tools: z.array(MamEntityIdSchema),
    permissions: PermissionPolicySchema,
    budget: BudgetPolicySchema,
    retry: RetryPolicySchema,
    contextPolicy: ContextPolicySchema
  })
  .strict()

export const EffectiveRoleConfigSnapshotSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    workflowRunId: MamEntityIdSchema,
    taskId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    roleProfile: ResolvedProfileRefSchema,
    executorProfile: ResolvedProfileRefSchema.extend({ kind: ExecutorKindSchema }).strict(),
    providerProfile: ResolvedProfileRefSchema,
    modelProfile: ResolvedProfileRefSchema,
    systemPromptRef: z.string().min(1),
    execution: z
      .object({
        executableRef: z.string().min(1),
        adapterOptions: z.record(z.string(), z.unknown()),
        providerProtocol: ProviderProtocolSchema,
        providerBaseUrl: z.url().optional(),
        providerSecretRef: z.string().min(1).optional(),
        providerHeaders: z.record(z.string(), z.string()).optional(),
        remoteModelId: z.string().min(1),
        modelCapabilities: ModelCapabilitiesSchema,
        inference: InferenceOptionsSchema
      })
      .strict(),
    skills: z.array(ResolvedSkillSchema),
    mcpBindings: z.array(ResolvedMcpBindingSchema),
    knowledgeBaseBindings: z.array(ResolvedKnowledgeBindingSchema),
    tools: z.array(MamEntityIdSchema),
    permissions: PermissionPolicySchema,
    budget: BudgetPolicySchema,
    retry: RetryPolicySchema,
    contextPolicy: ContextPolicySchema,
    localBindingIds: z.array(MamEntityIdSchema),
    contentHash: Sha256Schema,
    createdAt: IsoTimestampSchema
  })
  .strict()

export const RoleInstanceSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    roleProfileId: MamEntityIdSchema,
    roleProfileVersion: z.number().int().positive(),
    workflowRunId: MamEntityIdSchema,
    taskId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    effectiveConfigSnapshotId: MamEntityIdSchema,
    effectiveConfigHash: Sha256Schema,
    executorInvocationId: MamEntityIdSchema.optional(),
    workspacePath: z.string().min(1),
    status: z.enum(['created', 'starting', 'running', 'failed', 'completed', 'disposed']),
    createdAt: IsoTimestampSchema,
    startedAt: IsoTimestampSchema.optional(),
    completedAt: IsoTimestampSchema.optional()
  })
  .strict()

export type RoleProfile = z.infer<typeof RoleProfileSchema>
export type EffectiveRoleConfigSnapshot = z.infer<typeof EffectiveRoleConfigSnapshotSchema>
export type RoleInstance = z.infer<typeof RoleInstanceSchema>
