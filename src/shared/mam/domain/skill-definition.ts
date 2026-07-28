import { z } from 'zod'
import { ExecutorKindSchema } from './execution-profile'
import {
  IsoTimestampSchema,
  MamEntityIdSchema,
  MamSchemaVersionSchema,
  Sha256Schema
} from './primitives'

export const MamSkillDefinitionSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    version: z.number().int().positive(),
    name: z.string().min(1).max(120),
    description: z.string().max(2000),
    supportedExecutors: z.array(ExecutorKindSchema).min(1),
    contentDigest: Sha256Schema,
    enabled: z.boolean(),
    importedAt: IsoTimestampSchema
  })
  .strict()

export const MamLocalSkillBindingSchema = z
  .object({
    id: MamEntityIdSchema,
    skillId: MamEntityIdSchema,
    sourcePath: z.string().min(1).max(16_384),
    bindingIdentity: MamEntityIdSchema
  })
  .strict()

export const MamLockedSkillSchema = z
  .object({
    id: MamEntityIdSchema,
    version: z.number().int().positive(),
    contentDigest: Sha256Schema,
    executorKind: ExecutorKindSchema,
    localBindingId: MamEntityIdSchema,
    materializationTarget: z.string().min(1).max(16_384),
    status: z.enum(['locked', 'materialized', 'failed']),
    error: z.string().min(1).max(4000).optional()
  })
  .strict()

export type MamSkillDefinition = z.infer<typeof MamSkillDefinitionSchema>
export type MamLocalSkillBinding = z.infer<typeof MamLocalSkillBindingSchema>
export type MamLockedSkill = z.infer<typeof MamLockedSkillSchema>
