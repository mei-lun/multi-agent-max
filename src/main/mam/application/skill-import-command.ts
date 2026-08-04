import { MamEntityIdSchema } from '../../../shared/mam/domain/primitives'
import type { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'
import { validateSkillPackage } from '../skills/skill-package-validator'
import type { MamUiWritableProfiles } from './mam-profile-write-ports'

export async function importSkillProfile(input: {
  sourcePath: string
  profiles: MamUiWritableProfiles
  localSettings: MamLocalSettingsStore
  now(): string
}): Promise<void> {
  const validated = await validateSkillPackage(input.sourcePath)
  const id = validated.declaredId ?? normalizeSkillId(validated.name)
  const version = input.profiles.skills.listVersions(id).length + 1
  input.profiles.skills.save({
    schemaVersion: '1.0.0',
    id,
    version,
    name: validated.name,
    description: validated.description,
    supportedExecutors: validated.supportedExecutors ?? ['codex-cli', 'grok-cli', 'pi-rpc'],
    contentDigest: validated.contentDigest,
    enabled: true,
    importedAt: input.now()
  })
  input.localSettings.upsertSkillBinding({
    id: `binding.${id}`,
    skillId: id,
    sourcePath: validated.canonicalPath,
    bindingIdentity: input.localSettings.get().bindingIdentity
  })
}

function normalizeSkillId(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return MamEntityIdSchema.parse(normalized || 'skill.imported')
}
