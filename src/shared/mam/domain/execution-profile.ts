import { z } from 'zod'
import { MamEntityIdSchema, Sha256Schema } from './primitives'

export const ExecutorKindSchema = z.enum(['codex-cli', 'grok-cli', 'pi-rpc'])

export const ProviderProtocolSchema = z.enum([
  'openai-responses',
  'openai-completions',
  'anthropic-messages',
  'google-generative-ai',
  'executor-native'
])

export const ExecutorProfileSchema = z
  .object({
    id: MamEntityIdSchema,
    version: z.number().int().positive(),
    kind: ExecutorKindSchema,
    executableRef: z.string().min(1),
    adapterOptions: z.record(z.string(), z.unknown())
  })
  .strict()

export const ProviderProfileSchema = z
  .object({
    id: MamEntityIdSchema,
    version: z.number().int().positive(),
    protocol: ProviderProtocolSchema,
    baseUrl: z.url().optional(),
    secretRef: z.string().min(1).optional(),
    headers: z.record(z.string(), z.string()).optional()
  })
  .strict()

export const ModelCapabilitiesSchema = z
  .object({
    modalities: z.array(z.enum(['text', 'image', 'audio'])).min(1),
    supportsTools: z.boolean(),
    supportsStructuredOutput: z.boolean(),
    maxContextTokens: z.number().int().positive().optional()
  })
  .strict()

export const InferenceOptionsSchema = z.record(z.string(), z.unknown())

export const ModelProfileSchema = z
  .object({
    id: MamEntityIdSchema,
    version: z.number().int().positive(),
    displayName: z.string().min(1).max(160),
    providerProfileId: MamEntityIdSchema,
    remoteModelId: z.string().min(1),
    capabilities: ModelCapabilitiesSchema,
    defaultInference: InferenceOptionsSchema.optional()
  })
  .strict()

export const RoleExecutionBindingSchema = z
  .object({
    executorProfileId: MamEntityIdSchema,
    modelProfileId: MamEntityIdSchema,
    inferenceOverrides: InferenceOptionsSchema.optional()
  })
  .strict()

export const ExecutorCapabilitiesSchema = z
  .object({
    supportedProtocols: z.array(ProviderProtocolSchema),
    supportsCustomEndpoint: z.boolean(),
    supportsModelOverride: z.boolean(),
    supportsPerInstanceConfig: z.boolean(),
    supportsPerInstanceCredentials: z.boolean(),
    supportsSkills: z.boolean(),
    supportedMcpTransports: z.array(z.string().min(1)),
    supportsKnowledgeGateway: z.boolean(),
    supportsStructuredOutput: z.boolean(),
    supportsInvocationReconnect: z.boolean()
  })
  .strict()

export const ResolvedProfileRefSchema = z
  .object({
    id: MamEntityIdSchema,
    version: z.number().int().positive(),
    contentHash: Sha256Schema
  })
  .strict()

export const LocalSecretBindingSchema = z
  .object({
    id: MamEntityIdSchema,
    secretRef: z.string().min(1),
    bindingIdentity: MamEntityIdSchema
  })
  .strict()

export const LocalExecutorBindingSchema = z
  .object({
    id: MamEntityIdSchema,
    executorProfileId: MamEntityIdSchema,
    executablePath: z.string().min(1),
    configRoot: z.string().min(1),
    credentialSourcePath: z.string().min(1).optional(),
    bindingIdentity: MamEntityIdSchema
  })
  .strict()

export type ExecutorKind = z.infer<typeof ExecutorKindSchema>
export type ExecutorProfile = z.infer<typeof ExecutorProfileSchema>
export type ProviderProfile = z.infer<typeof ProviderProfileSchema>
export type ModelProfile = z.infer<typeof ModelProfileSchema>
export type RoleExecutionBinding = z.infer<typeof RoleExecutionBindingSchema>
export type ExecutorCapabilities = z.infer<typeof ExecutorCapabilitiesSchema>
export type LocalSecretBinding = z.infer<typeof LocalSecretBindingSchema>
export type LocalExecutorBinding = z.infer<typeof LocalExecutorBindingSchema>
