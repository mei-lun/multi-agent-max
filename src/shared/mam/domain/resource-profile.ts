import { z } from 'zod'
import { MamEntityIdSchema, Sha256Schema } from './primitives'

export const RoleSkillBindingSchema = z
  .object({
    skillId: MamEntityIdSchema
  })
  .strict()

export const RoleMcpBindingSchema = z
  .object({
    serverProfileId: MamEntityIdSchema,
    allowedTools: z.array(MamEntityIdSchema),
    allowedResources: z.array(z.string().min(1)),
    allowedPrompts: z.array(MamEntityIdSchema)
  })
  .strict()

export const RoleKnowledgeBaseBindingSchema = z
  .object({
    knowledgeBaseProfileId: MamEntityIdSchema,
    collections: z.array(z.string().min(1)).optional(),
    allowedOperations: z.array(z.enum(['search', 'read'])).min(1),
    retrievalPolicy: z
      .object({
        topK: z.number().int().positive(),
        maxContextTokens: z.number().int().positive(),
        filters: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional()
      })
      .strict(),
    required: z.boolean()
  })
  .strict()

export const McpServerProfileSchema = z
  .object({
    id: MamEntityIdSchema,
    version: z.number().int().positive(),
    displayName: z.string().min(1).max(160),
    transport: z.enum(['stdio', 'http', 'sse']),
    connectionRef: z.string().min(1),
    credentialRef: z.string().min(1).optional()
  })
  .strict()

export const KnowledgeBaseProfileSchema = z
  .object({
    id: MamEntityIdSchema,
    version: z.number().int().positive(),
    displayName: z.string().min(1).max(160),
    kind: z.enum([
      'project-files',
      'local-directory',
      'git-repository',
      'vector-store',
      'mcp-resource'
    ]),
    sourceRef: z.string().min(1),
    credentialRef: z.string().min(1).optional(),
    indexRevision: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.string()).optional()
  })
  .strict()

export const ResolvedSkillSchema = z
  .object({
    id: MamEntityIdSchema,
    version: z.number().int().positive(),
    contentDigest: Sha256Schema
  })
  .strict()

export const LocalKnowledgeBindingSchema = z
  .object({
    id: MamEntityIdSchema,
    knowledgeBaseProfileId: MamEntityIdSchema,
    bindingIdentity: MamEntityIdSchema,
    sourcePath: z.string().min(1).optional(),
    indexRevision: z.string().min(1).optional()
  })
  .strict()

export const ResolvedMcpBindingSchema = RoleMcpBindingSchema.extend({
  version: z.number().int().positive(),
  contentHash: Sha256Schema
}).strict()

export const ResolvedKnowledgeBindingSchema = RoleKnowledgeBaseBindingSchema.extend({
  version: z.number().int().positive(),
  contentHash: Sha256Schema,
  indexRevision: z.string().min(1).optional(),
  status: z.enum(['available', 'degraded'])
}).strict()

export type RoleSkillBinding = z.infer<typeof RoleSkillBindingSchema>
export type RoleMcpBinding = z.infer<typeof RoleMcpBindingSchema>
export type RoleKnowledgeBaseBinding = z.infer<typeof RoleKnowledgeBaseBindingSchema>
export type McpServerProfile = z.infer<typeof McpServerProfileSchema>
export type KnowledgeBaseProfile = z.infer<typeof KnowledgeBaseProfileSchema>
export type LocalKnowledgeBinding = z.infer<typeof LocalKnowledgeBindingSchema>
