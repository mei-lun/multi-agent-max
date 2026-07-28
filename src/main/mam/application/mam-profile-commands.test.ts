import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProfileCatalog } from '../profiles/profile-catalog'
import { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'
import { MamUiCommandService } from './mam-ui-command-service'
import { MamUiQueryService } from './mam-ui-query-service'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('MAM Profile Application commands', () => {
  it('saves immutable execution Profiles, local settings, and validated Skill imports', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-profile-commands-'))
    temporaryDirectories.push(root)
    const profiles = new ProfileCatalog(join(root, 'catalog'))
    const settings = new MamLocalSettingsStore(join(root, 'local-settings.json'), 'machine.test')
    const query = new MamUiQueryService(
      {
        roles: profiles.roles,
        workflows: profiles.workflows,
        executors: profiles.executors,
        providers: profiles.providers,
        models: profiles.models,
        skills: profiles.skills,
        mcpServers: profiles.mcpServers,
        knowledgeBases: profiles.knowledgeBases,
        localSettings: settings
      },
      undefined,
      () => '2026-07-28T20:00:00Z'
    )
    const service = new MamUiCommandService(
      query,
      { userId: 'user.owner', schedulerId: 'scheduler.desktop', now: () => '2026-07-28T20:00:00Z' },
      undefined,
      profiles,
      settings
    )

    const afterExecutor = service.saveProfile({
      kind: 'executor',
      profile: {
        id: 'executor.codex',
        version: 1,
        kind: 'codex-cli',
        executableRef: 'codex',
        adapterOptions: {}
      }
    })
    expect(afterExecutor.executors).toMatchObject([
      { id: 'executor.codex', version: 1, kind: 'codex-cli' }
    ])

    const afterSettings = service.saveLocalSettings({
      settings: {
        ...settings.get(),
        gitExecutable: '/usr/local/bin/git',
        defaultProjectDirectory: join(root, 'projects')
      }
    })
    expect(afterSettings.localSettings).toMatchObject({
      bindingIdentity: 'machine.test',
      gitExecutable: '/usr/local/bin/git'
    })

    const skillDirectory = join(root, 'skill-package')
    mkdirSync(skillDirectory)
    writeFileSync(
      join(skillDirectory, 'SKILL.md'),
      '---\nid: skill.release\nname: Release\ndescription: Prepare a release.\nmam-executors:\n  - codex-cli\n---\n\n# Release\n'
    )
    const afterSkill = await service.importSkill(skillDirectory)
    expect(afterSkill.skills).toMatchObject([
      { id: 'skill.release', version: 1, enabled: true, supportedExecutors: ['codex-cli'] }
    ])
    expect(afterSkill.localSettings.skillBindings).toMatchObject([
      {
        id: 'binding.skill.release',
        skillId: 'skill.release',
        sourcePath: realpathSync(skillDirectory),
        bindingIdentity: 'machine.test'
      }
    ])
  })
})
