import { readFile, readdir, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse as parseToml } from '@iarna/toml'
import type { ProfileCatalog } from '../profiles/profile-catalog'
import type { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'
import { validateSkillPackage, type ValidatedSkillPackage } from '../skills/skill-package-validator'
import {
  CodexResourceCandidateSchema,
  type CodexResourceCandidate
} from '../../../shared/mam/resource-import'
import { resolveCodexHome } from './codex-home-resolver'
import { createCodexMcpCandidates, type ResolvedCodexMcp } from './codex-mcp-candidate'
import { containedPath, directoryNames, enabledPluginKeys, readJson } from './codex-resource-files'
import { markResourceIdCollisions } from './codex-resource-collisions'
import {
  candidateKey,
  compareResourceVersions,
  configuredSkillPaths,
  discoveryErrorCode,
  hashValue,
  isRecord,
  mcpImportState,
  normalizeResourceId,
  safeResolveSecret,
  skillDiscoveryError,
  unavailableSkill,
  unavailableMcp
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
  localSecrets?: Readonly<{ resolveSecret(secretRef: string): string | undefined }>
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
    const config = await this.readConfig()
    const disabledSkillPaths = configuredSkillPaths(config, this.codexHome, false)
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
    for (let index = results.length - 1; index >= 0; index -= 1) {
      const resource = results[index]!
      if (
        resource.kind === 'skill' &&
        disabledSkillPaths.has(resolve(resource.package.canonicalPath))
      ) {
        results.splice(index, 1)
      }
    }
    await this.discoverConfiguredSkills(config, results, seenSkillPaths)
    results.push(...this.configMcpCandidates(config))
    await this.discoverPlugins(config, results, seenSkillPaths)
    return markResourceIdCollisions(results).sort((left, right) =>
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
          key: candidateKey('skill', canonical, validated.contentDigest),
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
            key: candidateKey(
              'skill',
              canonical,
              hashValue(`${canonical}:${discoveryErrorCode(error)}`)
            ),
            kind: 'skill',
            resourceId: normalizeResourceId(entry.name, 'skill'),
            displayName: entry.name,
            source: { ...source, path: canonical },
            fingerprint: hashValue(`${canonical}:${discoveryErrorCode(error)}`),
            importState: 'unavailable',
            requiredSecretNames: [],
            unavailableReason: skillDiscoveryError(error)
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
        if (!enabled.has(`${pluginName}@${marketplace}`)) continue
        const versions = await directoryNames(join(cache, marketplace, pluginName))
        const version = versions.sort(compareResourceVersions).at(-1)
        if (!version) continue
        const root = join(cache, marketplace, pluginName, version)
        const source = {
          kind: 'plugin' as const,
          label: `${pluginName}@${marketplace}`,
          path: root
        }
        const manifest = await readJson(join(root, '.codex-plugin', 'plugin.json'))
        if (!manifest) {
          results.push(
            ...this.mcpCandidates(
              unavailableMcp(pluginName, 'The plugin manifest could not be parsed.'),
              source,
              root
            )
          )
          continue
        }
        const skillRef = typeof manifest.skills === 'string' ? manifest.skills : undefined
        if (skillRef) {
          const skillRoot = containedPath(root, skillRef)
          await this.discoverSkillRoot(skillRoot, source, results, seen)
        }
        const mcpRef =
          typeof manifest.mcpServers === 'string' ? manifest.mcpServers : 'desktop-mcp.json'
        const mcp = await readJson(containedPath(root, mcpRef))
        const servers =
          mcp?.mcpServers ??
          (typeof manifest.mcpServers === 'string'
            ? unavailableMcp(pluginName, 'The plugin MCP manifest is unavailable.')
            : undefined)
        results.push(...this.mcpCandidates(servers, source, root))
      }
    }
  }

  private async discoverConfiguredSkills(
    config: Record<string, unknown>,
    results: ResolvedCodexCandidate[],
    seen: Set<string>
  ): Promise<void> {
    if (!isRecord(config.skills) || !Array.isArray(config.skills.config)) return
    for (const entry of config.skills.config) {
      if (!isRecord(entry) || entry.enabled === false || typeof entry.path !== 'string') continue
      const configuredPath = resolve(this.codexHome, entry.path)
      const directory = configuredPath.toLowerCase().endsWith('skill.md')
        ? resolve(configuredPath, '..')
        : configuredPath
      await this.discoverSingleSkill(
        directory,
        { kind: 'config', label: 'Codex config.toml', path: configuredPath },
        results,
        seen
      )
    }
  }

  private async discoverSingleSkill(
    path: string,
    source: CandidateSource,
    results: ResolvedCodexCandidate[],
    seen: Set<string>
  ): Promise<void> {
    const parent = resolve(path, '..')
    const name = path.slice(parent.length).replace(/^[/\\]/, '')
    await this.discoverSkillRoot(
      parent,
      source,
      results,
      seen,
      new Set((await directoryNames(parent)).filter((entry) => entry !== name))
    )
  }

  private async readConfig(): Promise<Record<string, unknown>> {
    try {
      const parsed = parseToml(await readFile(join(this.codexHome, 'config.toml'), 'utf8'))
      return isRecord(parsed) ? parsed : {}
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      return {
        mcp_servers: {
          'codex-config': {
            __unavailable_reason: 'Codex config.toml could not be parsed.'
          }
        }
      }
    }
  }

  private configMcpCandidates(config: Record<string, unknown>): ResolvedCodexMcp[] {
    return this.mcpCandidates(
      config.mcp_servers,
      {
        kind: 'config',
        label: 'Codex config.toml',
        path: join(this.codexHome, 'config.toml')
      },
      this.codexHome
    )
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
      importState: (profile, connection, credentials, missingTargets) =>
        mcpImportState({
          profile,
          connection,
          credentials,
          missingTargets,
          active: this.options.profiles?.mcpServers.getActive(profile.id),
          local: this.options.localSettings
            ?.get()
            .mcpConnections.find((item) => item.connectionRef === profile.connectionRef),
          storedCredentials: profile.credentialRef
            ? safeResolveSecret(this.options.localSecrets, profile.credentialRef)
            : undefined
        })
    })
  }

  private skillImportState(id: string, digest: string): CodexResourceCandidate['importState'] {
    const active = this.options.profiles?.skills.getActive(id)
    if (!active) return 'new'
    return active.contentDigest === digest ? 'current' : 'updated'
  }

  private candidate(input: CodexResourceCandidate): CodexResourceCandidate {
    return CodexResourceCandidateSchema.parse(input)
  }
}
