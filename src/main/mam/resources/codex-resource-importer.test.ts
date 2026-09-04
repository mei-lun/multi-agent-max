import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { ProfileCatalog } from '../profiles/profile-catalog'
import { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'
import { EncryptedLocalSecretStore } from '../application/encrypted-local-secret-store'
import { validateSkillPackage } from '../skills/skill-package-validator'
import { CodexResourceDiscovery } from './codex-resource-discovery'
import { CodexResourceImporter } from './codex-resource-importer'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Codex resource importer', () => {
  it('activates updated Skills and stores MCP credentials only in encrypted storage', async () => {
    const fixture = await createFixture()
    const candidates = await fixture.discovery.list()

    await fixture.importer.import({
      candidateKeys: candidates.map((candidate) => candidate.key),
      missingSecrets: {}
    })

    expect(fixture.profiles.skills.getActive('skill.release')?.version).toBe(2)
    expect(fixture.profiles.skills.listVersions('skill.release')).toHaveLength(2)
    expect(fixture.profiles.mcpServers.getActive('mcp.docs')).toMatchObject({
      version: 1,
      credentialRef: 'secret.mcp.docs'
    })
    const settings = fixture.settings.get()
    expect(settings.mcpConnections).toMatchObject([
      { connectionRef: 'mcp.docs.connection', transport: 'stdio', environment: {} }
    ])
    expect(JSON.stringify(settings)).not.toContain('sk-import-secret')
    expect(fixture.secrets.resolveSecret('secret.mcp.docs')).toContain('sk-import-secret')

    expect((await fixture.discovery.list()).every((candidate) => candidate.importState === 'current'))
      .toBe(true)
  })

  it('does not write any selected resource when a required environment value is missing', async () => {
    const fixture = await createFixture({ missingToken: true })
    const candidates = await fixture.discovery.list()

    await expect(
      fixture.importer.import({
        candidateKeys: candidates.map((candidate) => candidate.key),
        missingSecrets: {}
      })
    ).rejects.toThrow('mam_import_missing_secret:API_TOKEN')

    expect(fixture.profiles.skills.getActive('skill.release')?.version).toBe(1)
    expect(fixture.profiles.mcpServers.listActive()).toEqual([])
    expect(fixture.settings.get().mcpConnections).toEqual([])
    expect(fixture.secrets.listConfigured()).toEqual([])
  })
})

async function createFixture(options: { missingToken?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mam-codex-import-'))
  roots.push(root)
  const codexHome = join(root, 'codex')
  const oldSkill = join(root, 'old-skill')
  const newSkill = join(codexHome, 'skills', 'release')
  writeSkill(oldSkill, 'release', 'Old release instructions.')
  writeSkill(newSkill, 'release', 'New release instructions.')
  mkdirSync(codexHome, { recursive: true })
  writeFileSync(
    join(codexHome, 'config.toml'),
    options.missingToken
      ? '[mcp_servers.docs]\ncommand = "docs-mcp"\nenv_vars = ["API_TOKEN"]\n'
      : '[mcp_servers.docs]\ncommand = "docs-mcp"\n[mcp_servers.docs.env]\nAPI_TOKEN = "sk-import-secret"\n'
  )
  const profiles = new ProfileCatalog(join(root, 'catalog'))
  const settings = new MamLocalSettingsStore(join(root, 'settings.json'), 'machine.test')
  const old = await validateSkillPackage(oldSkill)
  profiles.skills.save({
    schemaVersion: '1.0.0',
    id: 'skill.release',
    version: 1,
    name: old.name,
    description: old.description,
    supportedExecutors: ['pi-rpc'],
    contentDigest: old.contentDigest,
    enabled: true,
    importedAt: '2026-09-03T00:00:00Z'
  })
  settings.upsertSkillBinding({
    id: 'binding.skill.release',
    skillId: 'skill.release',
    sourcePath: oldSkill,
    bindingIdentity: 'machine.test'
  })
  const secrets = new EncryptedLocalSecretStore(join(root, 'secrets.json'), {
    encrypt: (value) => Buffer.from(value, 'utf8'),
    decrypt: (value) => value.toString('utf8')
  })
  const discovery = new CodexResourceDiscovery({
    codexHome,
    environment: {},
    profiles,
    localSettings: settings
  })
  const importer = new CodexResourceImporter({
    discovery,
    profiles,
    localSettings: settings,
    localSecrets: secrets,
    transactionPath: join(root, 'import-transaction.json'),
    now: () => '2026-09-04T00:00:00Z'
  })
  return { profiles, settings, secrets, discovery, importer }
}

function writeSkill(directory: string, name: string, description: string): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n`)
}
