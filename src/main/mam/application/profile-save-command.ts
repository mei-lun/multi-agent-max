import { MamSaveProfileInputSchema } from '../../../shared/mam/application-command'
import type { MamUiWritableProfiles } from './mam-profile-write-ports'

export function saveCatalogProfile(input: unknown, profiles: MamUiWritableProfiles): void {
  const parsed = MamSaveProfileInputSchema.parse(input)
  const registries = {
    role: profiles.roles,
    executor: profiles.executors,
    provider: profiles.providers,
    model: profiles.models,
    skill: profiles.skills,
    mcp: profiles.mcpServers,
    knowledge: profiles.knowledgeBases
  } as const
  registries[parsed.kind].save(parsed.profile)
}
