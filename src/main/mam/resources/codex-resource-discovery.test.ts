import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import { CodexResourceDiscovery } from './codex-resource-discovery'
import { credentialsMatchSource } from './codex-resource-values'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Codex resource discovery', () => {
  it('discovers user, system, plugin and configured resources without exposing secrets', async () => {
    const root = fixtureRoot()
    writeSkill(join(root, 'skills', 'release'), 'release', 'Prepare releases.')
    writeSkill(join(root, 'skills', '.system', 'imagegen'), 'imagegen', 'Generate images.')
    const externalSkill = join(root, 'external', 'planning')
    writeSkill(externalSkill, 'planning', 'Plan external work.')
    const disabledSkill = join(root, 'skills', 'disabled-local')
    writeSkill(disabledSkill, 'disabled-local', 'Disabled locally.')
    const plugin = join(root, 'plugins', 'cache', 'market', 'browser', '1.0.0')
    writeSkill(join(plugin, 'skills', 'browser'), 'browser', 'Control a browser.')
    writeJson(join(plugin, '.codex-plugin', 'plugin.json'), {
      name: 'browser',
      version: '1.0.0',
      skills: './skills/',
      mcpServers: './.mcp.json'
    })
    writeJson(join(plugin, '.mcp.json'), {
      mcpServers: {
        browser: {
          type: 'http',
          url: 'https://browser.example.test/mcp',
          bearer_token_env_var: 'PLUGIN_TOKEN'
        }
      }
    })
    const disabledPlugin = join(root, 'plugins', 'cache', 'market', 'disabled', '1.0.0')
    writeSkill(join(disabledPlugin, 'skills', 'hidden'), 'hidden', 'Must stay hidden.')
    writeJson(join(disabledPlugin, '.codex-plugin', 'plugin.json'), {
      name: 'disabled',
      version: '1.0.0',
      skills: './skills/'
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
        'enabled = true',
        '',
        '[[skills.config]]',
        `path = "${join(externalSkill, 'SKILL.md').replaceAll('\\', '\\\\')}"`,
        'enabled = true',
        '',
        '[[skills.config]]',
        `path = "${join(disabledSkill, 'SKILL.md').replaceAll('\\', '\\\\')}"`,
        'enabled = false'
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
        ['skill', 'config'],
        ['mcp', 'config'],
        ['mcp', 'plugin']
      ])
    )
    expect(candidates.every((candidate) => candidate.importState === 'new')).toBe(true)
    expect(JSON.stringify(candidates)).not.toContain('sk-test-secret')
    expect(JSON.stringify(candidates)).not.toContain('plugin-secret')
    expect(candidates.map((candidate) => candidate.resourceId)).toContain('skill.planning')
    expect(candidates.map((candidate) => candidate.resourceId)).not.toContain('skill.hidden')
    expect(candidates.map((candidate) => candidate.resourceId)).not.toContain(
      'skill.disabled-local'
    )

    const docs = candidates.find((candidate) => candidate.resourceId === 'mcp.docs')!
    const resolved = await discovery.resolve(docs.key)
    expect(resolved?.kind).toBe('mcp')
    expect(resolved?.kind === 'mcp' ? resolved.credentials.environment.API_TOKEN : undefined).toBe(
      'sk-test-secret'
    )
    const browser = candidates.find((candidate) => candidate.resourceId === 'mcp.browser')!
    const resolvedBrowser = await discovery.resolve(browser.key)
    expect(resolvedBrowser?.kind === 'mcp' ? resolvedBrowser.connection.transport : undefined).toBe(
      'http'
    )
    expect(
      resolvedBrowser?.kind === 'mcp'
        ? resolvedBrowser.credentials.headers.Authorization
        : undefined
    ).toBe('Bearer plugin-secret')
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
    expect(
      resolved?.kind === 'mcp' ? resolved.missingCredentialTargets.MISSING_TOKEN : undefined
    ).toEqual({ kind: 'environment', key: 'MISSING_TOKEN' })
  })

  it('invalidates an import key when the previewed Skill content changes', async () => {
    const root = fixtureRoot()
    const skill = join(root, 'skills', 'release')
    writeSkill(skill, 'release', 'First content.')
    const discovery = new CodexResourceDiscovery({ codexHome: root, environment: {} })
    const key = (await discovery.list())[0]!.key

    writeSkill(skill, 'release', 'Changed after preview.')

    await expect(discovery.resolve(key)).resolves.toBeUndefined()
  })

  it('detects removed keys in a stored MCP credential bundle', () => {
    expect(
      credentialsMatchSource(
        JSON.stringify({
          environment: { CURRENT_TOKEN: 'current', REMOVED_TOKEN: 'stale' },
          headers: {}
        }),
        { environment: { CURRENT_TOKEN: 'current' }, headers: {} },
        {}
      )
    ).toBe(false)
  })

  it('marks normalized ID collisions and malformed MCP config as unavailable', async () => {
    const collisionRoot = fixtureRoot()
    writeSkill(join(collisionRoot, 'skills', 'first'), 'Foo Bar', 'First.')
    writeSkill(join(collisionRoot, 'skills', 'second'), 'foo-bar', 'Second.')
    const collisions = await new CodexResourceDiscovery({ codexHome: collisionRoot }).list()
    expect(collisions).toHaveLength(2)
    expect(collisions.every((candidate) => candidate.importState === 'unavailable')).toBe(true)
    expect(
      collisions.every((candidate) => candidate.unavailableReason?.includes('same MAM ID'))
    ).toBe(true)

    const malformedRoot = fixtureRoot()
    writeFileSync(join(malformedRoot, 'config.toml'), '[mcp_servers.invalid\ncommand =')
    await expect(new CodexResourceDiscovery({ codexHome: malformedRoot }).list()).resolves.toEqual([
      expect.objectContaining({
        resourceId: 'mcp.codex-config',
        importState: 'unavailable',
        unavailableReason: 'Codex config.toml could not be parsed.'
      })
    ])
  })
})

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mam-codex-discovery-'))
  roots.push(root)
  return root
}

function writeSkill(directory: string, name: string, description: string): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n`
  )
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}
