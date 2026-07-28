import { z } from 'zod'
import { LocalExecutorBindingSchema, LocalSecretBindingSchema } from './domain/execution-profile'
import { LocalKnowledgeBindingSchema } from './domain/resource-profile'
import { MamLocalSkillBindingSchema } from './domain/skill-definition'
import { MamEntityIdSchema, MamSchemaVersionSchema } from './domain/primitives'

export const MamLocalSettingsSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    bindingIdentity: MamEntityIdSchema,
    gitExecutable: z.string().min(1),
    defaultProjectDirectory: z.string().min(1).optional(),
    executorBindings: z.array(LocalExecutorBindingSchema),
    secretBindings: z.array(LocalSecretBindingSchema),
    skillBindings: z.array(MamLocalSkillBindingSchema),
    knowledgeBindings: z.array(LocalKnowledgeBindingSchema)
  })
  .strict()

export type MamLocalSettings = z.infer<typeof MamLocalSettingsSchema>

export function defaultMamLocalSettings(bindingIdentity = 'machine.local'): MamLocalSettings {
  return {
    schemaVersion: '1.0.0',
    bindingIdentity,
    gitExecutable: 'git',
    executorBindings: [],
    secretBindings: [],
    skillBindings: [],
    knowledgeBindings: []
  }
}
