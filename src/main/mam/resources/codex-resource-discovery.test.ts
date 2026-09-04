import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import { CodexResourceDiscovery } from './codex-resource-discovery'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Codex resource discovery', () => {
  it('discovers user, system, plugin and configured resources without exposing secrets', async () => {
    const root = fixtureRoot()
    writeSkill(join(root, 'skills', 'release'), 'release', 'Prepare releases.')
    writeSkill(join(root, 'skills', '.system', 'imagegen'), 'imagegen', 'Generate images.')
    const plugin = join(root, 'plugins', 'cache', 'market', 'browser', '1.0.0')
    writeSkill(join(plugin, 'skills', 'browser'), 'browser', 'Control a browser.')
    writeJson(join(plugin, '.codex-plugin', 'plugin.json'), {
      name: 'browser',
      version: '1.0.0',
      skills: './skills/'
    })
    writeJson(join(plugin, 'desktop-mcp.json'), {
      mcpServers: {
        browser: { command: 'browser-mcp', args: [], env_vars: ['PLUGIN_TOKEN'] }
      }
    })
    writeFileSync(
      join(root, 'config.toml'),
      [
        '[mcp_servers.docs]',
        'command = "docs-mcp"',
        'args = ["--stdio"]',
        '[mcp_servers.docs.env]',
        'API_TOKEN = "sk-test-secret"',
        '',
        '[plugins."browser@market"]',
        'enabled = true'
      ].join('\n')
    )

    const discovery = new CodexResourceDiscovery({
      codexHome: root,
      environment: { PLUGIN_TOKEN: 'plugin-secret' }
    })
    const candidates = await discovery.list()

    expect(candidates.map(({ kind, source }) => [kind, source.kind])).toEqual(
      expect.arrayContaining([
        ['skill', 'user'],
        ['skill', 'system'],
        ['skill', 'plugin'],
        ['mcp', 'config'],
        ['mcp', 'plugin']
      ])
    )
    expect(candidates.every((candidate) => candidate.importState === 'new')).toBe(true)
    expect(JSON.stringify(candidates)).not.toContain('sk-test-secret')
    expect(JSON.stringify(candidates)).not.toContain('plugin-secret')

    const docs = candidates.find((candidate) => candidate.resourceId === 'mcp.docs')!
    const resolved = await discovery.resolve(docs.key)
    expect(resolved?.kind).toBe('mcp')
    expect(resolved?.kind === 'mcp' ? resolved.credentials.environment.API_TOKEN : undefined).toBe(
      'sk-test-secret'
    )
  })

  it('marks missing Skill metadata and unresolved MCP environment as unavailable', async () => {
    const root = fixtureRoot()
    mkdirSync(join(root, 'skills', 'broken'), { recursive: true })
    writeFileSync(
      join(root, 'config.toml'),
      '[mcp_servers.private]\ncommand = "private-mcp"\nenv_vars = ["MISSING_TOKEN"]\n'
    )

    const candidates = await new CodexResourceDiscovery({
      codexHome: root,
      environment: {}
    }).list()

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'skill', importState: 'unavailable' }),
        expect.objectContaining({
          resourceId: 'mcp.private',
          requiredSecretNames: ['MISSING_TOKEN'],
          importState: 'new'
        })
      ])
    )
    const privateMcp = candidates.find((candidate) => candidate.resourceId === 'mcp.private')!
    const resolved = await new CodexResourceDiscovery({
      codexHome: root,
      environment: {}
    }).resolve(privateMcp.key)
    expect(resolved?.kind === 'mcp' ? resolved.missingCredentialTargets.MISSING_TOKEN : undefined)
      .toEqual({ kind: 'environment', key: 'MISSING_TOKEN' })
  })
})

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mam-codex-discovery-'))
  roots.push(root)
  return root
}

function writeSkill(directory: string, name: string, description: string): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n`)
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}
