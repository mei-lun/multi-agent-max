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
    const savedSecrets = new Map<string, string>()
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
      settings,
      { save: (secretRef, value) => savedSecrets.set(secretRef, value) }
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

    const afterRole = service.saveProfile({ kind: 'role', profile: roleProfile() })
    expect(afterRole.roles).toMatchObject([
      { id: 'role.requirements', displayName: 'Requirements' }
    ])
    const afterRoleDelete = service.deleteRoleProfile({ roleProfileId: 'role.requirements' })
    expect(afterRoleDelete.roles).toEqual([])
    expect(profiles.roles.listVersions('role.requirements')).toHaveLength(1)

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

    const afterConnection = service.saveModelConnection({
      displayName: 'Relay coding model',
      protocol: 'openai-completions',
      baseUrl: 'https://relay.example.com/v1',
      apiKey: 'sk-local-test-value',
      remoteModelId: 'relay-model-v2'
    })
    const provider = afterConnection.providers[0]!
    expect(provider).toMatchObject({
      protocol: 'openai-completions',
      baseUrl: 'https://relay.example.com/v1'
    })
    expect(afterConnection.models[0]).toMatchObject({
      displayName: 'Relay coding model',
      providerProfileId: provider.id,
      remoteModelId: 'relay-model-v2'
    })
    expect(savedSecrets.get(provider.secretRef!)).toBe('sk-local-test-value')
    expect(JSON.stringify(afterConnection)).not.toContain('sk-local-test-value')

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

function roleProfile() {
  return {
    schemaVersion: '1.0.0' as const,
    id: 'role.requirements',
    version: 1,
    displayName: 'Requirements',
    execution: { executorProfileId: 'executor.codex', modelProfileId: 'model.codex' },
    systemPromptRef: 'inline:Write requirements.',
    skillBindings: [{ skillId: 'skill.requirements' }],
    mcpBindings: [],
    knowledgeBaseBindings: [],
    tools: [],
    permissions: {
      readPaths: [],
      writePaths: [],
      allowedCommands: [],
      deniedCommands: [],
      allowedNetworkHosts: [],
      requireApprovalFor: []
    },
    budget: {
      maxInputTokens: 10_000,
      maxOutputTokens: 4_000,
      maxCostUsd: 2,
      maxDurationSeconds: 600
    },
    retry: { maxAttempts: 2, initialBackoffMs: 1_000, maxBackoffMs: 10_000 },
    contextPolicy: {
      maxContextTokens: 10_000,
      compaction: 'disabled' as const,
      includePreviousAttempts: true
    }
  }
}
