import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MamSaveProfileInputSchema } from '../../../../shared/mam/application-command'
import type { RoleProfile } from '../../../../shared/mam/domain/role'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { MamProfileForm } from './MamProfileForm'
import { mamProfileTemplate } from './mam-profile-templates'
import { mamUiSnapshotFixture } from './mam-renderer-snapshot-fixture'

describe('MAM Profile forms', () => {
  it('renders a beginner-facing Role form with registered choices', () => {
    const snapshot = profileSnapshot()
    const profile = {
      ...mamProfileTemplate('role', snapshot),
      skillBindings: [{ skillId: 'skill.release' }],
      mcpBindings: [{ serverProfileId: 'mcp.project' }],
      knowledgeBaseBindings: [{ knowledgeBaseProfileId: 'knowledge.docs' }]
    } as RoleProfile

    const html = renderToStaticMarkup(
      <MamProfileForm
        kind="role"
        profile={profile}
        snapshot={snapshot}
        onChange={() => undefined}
      />
    )

    expect(html).toContain('Role name')
    expect(html).toContain('Role instructions')
    expect(html).toContain('Resources')
    expect(html).toContain('Release Skill')
    expect(html).toContain('Project MCP')
    expect(html).toContain('Product docs')
    expect(html).not.toContain('Allowed tools')
    expect(html).not.toContain('Allowed resources')
    expect(html).not.toContain('Allowed prompts')
    expect(html).not.toContain('Collections')
    expect(html).not.toContain('Top results')
    expect(html).toContain('Limits')
    expect(html).not.toContain('Network access')
    expect(html).not.toContain('File changes')
    expect(html).not.toContain('schemaVersion')
    expect(MamSaveProfileInputSchema.parse({ kind: 'role', profile })).toBeDefined()
  })

  it.each([
    ['executor', 'Executor type'],
    ['provider', 'API format'],
    ['model', 'Model name'],
    ['mcp', 'Server name'],
    ['knowledge', 'Knowledge base name']
  ] as const)('renders %s settings as fields', (kind, expectedLabel) => {
    const snapshot = profileSnapshot()
    const profile = mamProfileTemplate(kind, snapshot)
    const html = renderToStaticMarkup(
      <MamProfileForm
        kind={kind}
        profile={profile}
        snapshot={snapshot}
        onChange={() => undefined}
      />
    )

    expect(html).toContain(expectedLabel)
    expect(html).not.toContain('Profile JSON')
    expect(MamSaveProfileInputSchema.parse({ kind, profile })).toBeDefined()
  })

  it('generates a new stable ID instead of reusing an existing Profile', () => {
    const snapshot = profileSnapshot()
    snapshot.roles.push({
      ...snapshot.roles[0]!,
      id: 'role.new',
      displayName: 'Existing role'
    })
    snapshot.roles.push({
      ...snapshot.roles[0]!,
      id: 'role.new.2',
      displayName: 'Existing role 2'
    })

    expect(mamProfileTemplate('role', snapshot).id).toBe('role.new.3')
  })
})

function profileSnapshot(): MamUiSnapshot {
  const snapshot = mamUiSnapshotFixture()
  snapshot.executors.push({
    id: 'executor.codex',
    version: 1,
    kind: 'codex-cli',
    executableRef: 'codex',
    adapterOptions: {}
  })
  snapshot.providers.push({
    id: 'provider.openai',
    version: 1,
    protocol: 'openai-responses',
    secretRef: 'secret.openai'
  })
  snapshot.models.push({
    id: 'model.codex',
    version: 1,
    displayName: 'Coding model',
    providerProfileId: 'provider.openai',
    remoteModelId: 'coding-model',
    capabilities: {
      modalities: ['text'],
      supportsTools: true,
      supportsStructuredOutput: true
    }
  })
  snapshot.skills.push({
    schemaVersion: '1.0.0',
    id: 'skill.release',
    version: 1,
    name: 'Release Skill',
    description: 'Prepare a release.',
    supportedExecutors: ['codex-cli'],
    contentDigest: 'b'.repeat(64),
    enabled: true,
    importedAt: '2026-07-28T18:00:00Z'
  })
  snapshot.mcpServers.push({
    id: 'mcp.project',
    version: 1,
    displayName: 'Project MCP',
    transport: 'stdio',
    connectionRef: 'mcp.connection.project'
  })
  snapshot.knowledgeBases.push({
    id: 'knowledge.docs',
    version: 1,
    displayName: 'Product docs',
    kind: 'project-files',
    sourceRef: 'docs'
  })
  return snapshot
}
