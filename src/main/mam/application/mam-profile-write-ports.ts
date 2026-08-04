import type { MamSkillDefinition } from '../../../shared/mam/domain/skill-definition'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'

type WritableRegistry<T = unknown> = Readonly<{
  save(input: unknown): T
  listVersions(id: string): readonly T[]
  deactivate?(id: string): void
}>

export type MamUiWritableProfiles = Readonly<{
  roles: WritableRegistry
  executors: WritableRegistry
  providers: WritableRegistry
  models: WritableRegistry
  skills: WritableRegistry<MamSkillDefinition>
  mcpServers: WritableRegistry
  knowledgeBases: WritableRegistry
  workflows: WritableRegistry<WorkflowDefinition>
}>

export type MamLocalSecretWriter = Readonly<{
  save(secretRef: string, value: string): void
}>
