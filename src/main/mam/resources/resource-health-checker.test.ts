import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { ProfileCatalog } from '../profiles/profile-catalog'
import { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'
import { EncryptedLocalSecretStore } from '../application/encrypted-local-secret-store'
import { validateSkillPackage } from '../skills/skill-package-validator'
import { ResourceHealthStore } from './resource-health-store'
import { ResourceHealthChecker } from './resource-health-checker'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('resource health checker', () => {
  it('isolates failures and checks Skills and Knowledge Bases through Pi paths', async () => {
    const fixture = await createFixture()
    const checker = new ResourceHealthChecker({
      ...fixture,
      probeMcp: async () => {
        throw new Error('server rejected sk-health-secret')
      },
      now: () => '2026-09-04T08:00:00Z'
    })

    const results = await checker.checkAll()

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceId: 'skill.release', status: 'healthy' }),
        expect.objectContaining({ resourceId: 'mcp.docs', status: 'pi-incompatible' }),
        expect.objectContaining({ resourceId: 'knowledge.docs', status: 'healthy' })
      ])
    )
    expect(JSON.stringify(results)).not.toContain('sk-health-secret')
    expect(checker.listCurrent()).toHaveLength(3)
  })

  it('invalidates cached results when a local binding changes', async () => {
    const fixture = await createFixture()
    const checker = new ResourceHealthChecker({
      ...fixture,
      probeMcp: async () => ({ connected: true, tools: 0, resources: 0, prompts: 0 })
    })
    await checker.checkAll()
    const settings = fixture.localSettings.get()
    fixture.localSettings.save({
      ...settings,
      knowledgeBindings: settings.knowledgeBindings.map((binding) => ({
        ...binding,
        sourcePath: join(fixture.root, 'other')
      }))
    })

    expect(checker.listCurrent().map((result) => result.resourceId)).not.toContain(
      'knowledge.docs'
    )
  })
})

async function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'mam-resource-health-'))
  roots.push(root)
  const skillPath = join(root, 'skill')
  const knowledgePath = join(root, 'knowledge')
  mkdirSync(skillPath)
  mkdirSync(knowledgePath)
  writeFileSync(
    join(skillPath, 'SKILL.md'),
    '---\nname: release\ndescription: Prepare releases.\n---\nUse release evidence.\n'
  )
  writeFileSync(join(knowledgePath, 'README.md'), 'Product notes.\n')
  const profiles = new ProfileCatalog(join(root, 'catalog'))
  const localSettings = new MamLocalSettingsStore(join(root, 'settings.json'), 'machine.test')
  const validated = await validateSkillPackage(skillPath)
  profiles.skills.save({
    schemaVersion: '1.0.0',
    id: 'skill.release',
    version: 1,
    name: validated.name,
    description: validated.description,
    supportedExecutors: ['pi-rpc'],
    contentDigest: validated.contentDigest,
    enabled: true,
    importedAt: '2026-09-04T00:00:00Z'
  })
  profiles.mcpServers.save({
    id: 'mcp.docs',
    version: 1,
    displayName: 'Docs',
    transport: 'stdio',
    connectionRef: 'mcp.docs.connection',
    credentialRef: 'secret.mcp.docs'
  })
  profiles.knowledgeBases.save({
    id: 'knowledge.docs',
    version: 1,
    displayName: 'Docs',
    kind: 'local-directory',
    sourceRef: 'local.docs'
  })
  const settings = localSettings.get()
  localSettings.save({
    ...settings,
    skillBindings: [
      {
        id: 'binding.skill.release',
        skillId: 'skill.release',
        sourcePath: skillPath,
        bindingIdentity: settings.bindingIdentity
      }
    ],
    mcpConnections: [
      {
        connectionRef: 'mcp.docs.connection',
        transport: 'stdio',
        command: 'docs-mcp',
        args: [],
        environment: {}
      }
    ],
    secretBindings: [
      {
        id: 'secret.mcp.docs',
        secretRef: 'secret.mcp.docs',
        bindingIdentity: settings.bindingIdentity
      }
    ],
    knowledgeBindings: [
      {
        id: 'binding.knowledge.docs',
        knowledgeBaseProfileId: 'knowledge.docs',
        bindingIdentity: settings.bindingIdentity,
        sourcePath: knowledgePath
      }
    ]
  })
  const localSecrets = new EncryptedLocalSecretStore(join(root, 'secrets.json'), {
    encrypt: (value) => Buffer.from(value),
    decrypt: (value) => value.toString('utf8')
  })
  localSecrets.save(
    'secret.mcp.docs',
    JSON.stringify({ environment: { API_TOKEN: 'sk-health-secret' }, headers: {} })
  )
  return {
    root,
    profiles,
    localSettings,
    localSecrets,
    projectDirectory: root,
    store: new ResourceHealthStore(join(root, 'resource-health.json'))
  }
}
