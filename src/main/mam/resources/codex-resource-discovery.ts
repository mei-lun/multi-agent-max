import { readFile, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parse as parseToml } from '@iarna/toml'
import type { ProfileCatalog } from '../profiles/profile-catalog'
import type { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'
import { validateSkillPackage, type ValidatedSkillPackage } from '../skills/skill-package-validator'
import {
  CodexResourceCandidateSchema,
  type CodexResourceCandidate
} from '../../../shared/mam/resource-import'
import type { McpLocalConnection, McpServerProfile } from '../../../shared/mam/domain/resource-profile'
import { resolveCodexHome } from './codex-home-resolver'
import { createCodexMcpCandidates, type ResolvedCodexMcp } from './codex-mcp-candidate'
import {
  candidateKey,
  canonicalJson,
  hashValue,
  isRecord,
  normalizeResourceId
} from './codex-resource-values'

type CandidateSource = CodexResourceCandidate['source']

export type ResolvedCodexCandidate = ResolvedCodexSkill | ResolvedCodexMcp

export type ResolvedCodexSkill = Readonly<{
  kind: 'skill'
  candidate: CodexResourceCandidate
  package: ValidatedSkillPackage
}>

export type { ResolvedCodexMcp } from './codex-mcp-candidate'

export type CodexResourceDiscoveryOptions = Readonly<{
  codexHome?: string
  environment?: Readonly<Record<string, string | undefined>>
  profiles?: Pick<ProfileCatalog, 'skills' | 'mcpServers'>
  localSettings?: MamLocalSettingsStore
}>

export class CodexResourceDiscovery {
  private readonly codexHome: string
  private readonly environment: Readonly<Record<string, string | undefined>>

  constructor(private readonly options: CodexResourceDiscoveryOptions = {}) {
    this.codexHome = resolveCodexHome(options.codexHome)
    this.environment = options.environment ?? process.env
  }

  async list(): Promise<readonly CodexResourceCandidate[]> {
    return (await this.discover()).map((item) => item.candidate)
  }

  async resolve(key: string): Promise<ResolvedCodexCandidate | undefined> {
    return (await this.discover()).find((item) => item.candidate.key === key)
  }

  private async discover(): Promise<ResolvedCodexCandidate[]> {
    const results: ResolvedCodexCandidate[] = []
    const seenSkillPaths = new Set<string>()
    await this.discoverSkillRoot(
      join(this.codexHome, 'skills'),
      { kind: 'user', label: 'User Skills', path: join(this.codexHome, 'skills') },
      results,
      seenSkillPaths,
      new Set(['.system'])
    )
    await this.discoverSkillRoot(
      join(this.codexHome, 'skills', '.system'),
      {
        kind: 'system',
        label: 'Built-in Skills',
        path: join(this.codexHome, 'skills', '.system')
      },
      results,
      seenSkillPaths
    )
    const config = await this.readConfig()
    results.push(...this.configMcpCandidates(config))
    await this.discoverPlugins(config, results, seenSkillPaths)
    return results.sort((left, right) =>
      `${left.candidate.kind}:${left.candidate.displayName}:${left.candidate.key}`.localeCompare(
        `${right.candidate.kind}:${right.candidate.displayName}:${right.candidate.key}`
      )
    )
  }

  private async discoverSkillRoot(
    root: string,
    source: CandidateSource,
    results: ResolvedCodexCandidate[],
    seen: Set<string>,
    excluded = new Set<string>()
  ): Promise<void> {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || excluded.has(entry.name)) continue
      const path = join(root, entry.name)
      let canonical = resolve(path)
      try {
        canonical = await realpath(path)
        if (seen.has(canonical)) continue
        seen.add(canonical)
        const validated = await validateSkillPackage(canonical)
        const resourceId = normalizeResourceId(validated.declaredId ?? validated.name, 'skill')
        const candidate = this.candidate({
          key: candidateKey('skill', canonical),
          kind: 'skill',
          resourceId,
          displayName: validated.name,
          source: { ...source, path: canonical },
          fingerprint: validated.contentDigest,
          importState: this.skillImportState(resourceId, validated.contentDigest),
          requiredSecretNames: []
        })
        results.push({ kind: 'skill', candidate, package: validated })
      } catch (error) {
        results.push({
          kind: 'skill',
          candidate: this.candidate({
            key: candidateKey('skill', canonical),
            kind: 'skill',
            resourceId: normalizeResourceId(entry.name, 'skill'),
            displayName: entry.name,
            source: { ...source, path: canonical },
            fingerprint: hashValue(`${canonical}:${errorCode(error)}`),
            importState: 'unavailable',
            requiredSecretNames: [],
            unavailableReason: friendlyError(error)
          }),
          package: unavailableSkill(canonical, entry.name)
        })
      }
    }
  }

  private async discoverPlugins(
    config: Record<string, unknown>,
    results: ResolvedCodexCandidate[],
    seen: Set<string>
  ): Promise<void> {
    const enabled = enabledPluginKeys(config)
    const cache = join(this.codexHome, 'plugins', 'cache')
    for (const marketplace of await directoryNames(cache)) {
      for (const pluginName of await directoryNames(join(cache, marketplace))) {
        if (enabled.size > 0 && !enabled.has(`${pluginName}@${marketplace}`)) continue
        const versions = await directoryNames(join(cache, marketplace, pluginName))
        const version = versions.sort(compareVersions).at(-1)
        if (!version) continue
        const root = join(cache, marketplace, pluginName, version)
        const manifestPath = join(root, '.codex-plugin', 'plugin.json')
        const manifest = await readJson(manifestPath)
        if (!manifest) continue
        const source = { kind: 'plugin' as const, label: `${pluginName}@${marketplace}`, path: root }
        const skillRef = typeof manifest.skills === 'string' ? manifest.skills : undefined
        if (skillRef) {
          const skillRoot = containedPath(root, skillRef)
          await this.discoverSkillRoot(skillRoot, source, results, seen)
        }
        const mcp = await readJson(join(root, 'desktop-mcp.json'))
        results.push(...this.mcpCandidates(mcp?.mcpServers, source, root))
      }
    }
  }

  private async readConfig(): Promise<Record<string, unknown>> {
    try {
      const parsed = parseToml(await readFile(join(this.codexHome, 'config.toml'), 'utf8'))
      return isRecord(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  private configMcpCandidates(config: Record<string, unknown>): ResolvedCodexMcp[] {
    return this.mcpCandidates(config.mcp_servers, {
      kind: 'config',
      label: 'Codex config.toml',
      path: join(this.codexHome, 'config.toml')
    }, this.codexHome)
  }

  private mcpCandidates(
    input: unknown,
    source: CandidateSource,
    baseDirectory: string
  ): ResolvedCodexMcp[] {
    return createCodexMcpCandidates({
      servers: input,
      source,
      baseDirectory,
      environment: this.environment,
      importState: (profile, connection) => this.mcpImportState(profile, connection)
    })
  }

  private skillImportState(id: string, digest: string): CodexResourceCandidate['importState'] {
    const active = this.options.profiles?.skills.getActive(id)
    if (!active) return 'new'
    return active.contentDigest === digest ? 'current' : 'updated'
  }

  private mcpImportState(
    profile: Omit<McpServerProfile, 'version'>,
    connection: McpLocalConnection
  ): CodexResourceCandidate['importState'] {
    const active = this.options.profiles?.mcpServers.getActive(profile.id)
    if (!active) return 'new'
    const { version: _version, ...activeContent } = active
    const local = this.options.localSettings
      ?.get()
      .mcpConnections.find((item) => item.connectionRef === profile.connectionRef)
    return canonicalJson(activeContent) === canonicalJson(profile) && canonicalJson(local) === canonicalJson(connection)
      ? 'current'
      : 'updated'
  }

  private candidate(input: CodexResourceCandidate): CodexResourceCandidate {
    return CodexResourceCandidateSchema.parse(input)
  }
}


async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

async function directoryNames(path: string): Promise<string[]> {
  return (await readdir(path, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

function enabledPluginKeys(config: Record<string, unknown>): Set<string> {
  if (!isRecord(config.plugins)) return new Set()
  return new Set(
    Object.entries(config.plugins)
      .filter(([, value]) => !isRecord(value) || value.enabled !== false)
      .map(([key]) => key)
  )
}

function containedPath(root: string, child: string): string {
  const target = resolve(root, child)
  const traversal = relative(root, target)
  if (traversal === '..' || traversal.startsWith(`..${sep}`) || isAbsolute(traversal)) {
    throw new Error('plugin_path_escape')
  }
  return target
}

function compareVersions(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true })
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function friendlyError(error: unknown): string {
  const code = errorCode(error)
  if (code.includes('missing_skill_md')) return 'SKILL.md is missing.'
  return 'The Skill package could not be read.'
}

function unavailableSkill(path: string, name: string): ValidatedSkillPackage {
  return { canonicalPath: path, name, description: '', contentDigest: hashValue(path) }
}
