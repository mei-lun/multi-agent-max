import { resolve } from 'node:path'
import { loadSkills } from '@earendil-works/pi-coding-agent'
import type { ResourceHealthResult } from '../../../shared/mam/resource-health'
import type { McpLocalConnection, McpServerProfile } from '../../../shared/mam/domain/resource-profile'
import type { EncryptedLocalSecretStore } from '../application/encrypted-local-secret-store'
import { FileKnowledgeConnector } from '../gateways/file-knowledge-connector'
import { resolveMcpConnection } from '../gateways/mcp-connection-resolver'
import { McpSdkConnector } from '../gateways/mcp-sdk-connector'
import type { ProfileCatalog } from '../profiles/profile-catalog'
import { profileContentHash } from '../profiles/profile-content-hash'
import type { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'
import { validateSkillPackage } from '../skills/skill-package-validator'
import type { ResourceHealthStore } from './resource-health-store'

type McpProbeResult = Readonly<{
  connected: true
  tools: number
  resources: number
  prompts: number
}>

export type ResourceHealthCheckerOptions = Readonly<{
  profiles: ProfileCatalog
  localSettings: MamLocalSettingsStore
  localSecrets: EncryptedLocalSecretStore
  projectDirectory: string
  store: ResourceHealthStore
  now?: () => string
  probeMcp?: (profile: McpServerProfile, connection: McpLocalConnection) => Promise<McpProbeResult>
}>

type Descriptor = Readonly<{
  kind: ResourceHealthResult['kind']
  resourceId: string
  version: number
  fingerprint: string
  check(): Promise<Omit<ResourceHealthResult, 'kind' | 'resourceId' | 'version' | 'fingerprint'>>
}>

export class ResourceHealthChecker {
  private readonly now: () => string

  constructor(private readonly options: ResourceHealthCheckerOptions) {
    this.now = options.now ?? (() => new Date().toISOString())
  }

  async checkAll(): Promise<readonly ResourceHealthResult[]> {
    const descriptors = this.descriptors()
    const results = await mapLimit(descriptors, 3, async (descriptor) => ({
      kind: descriptor.kind,
      resourceId: descriptor.resourceId,
      version: descriptor.version,
      fingerprint: descriptor.fingerprint,
      ...(await descriptor.check())
    }))
    this.options.store.save(results)
    return results
  }

  listCurrent(): readonly ResourceHealthResult[] {
    const current = new Map(
      this.descriptors().map((item) => [healthKey(item), item.fingerprint] as const)
    )
    return this.options.store
      .list()
      .filter((result) => current.get(healthKey(result)) === result.fingerprint)
  }

  private descriptors(): Descriptor[] {
    const settings = this.options.localSettings.get()
    return [
      ...this.options.profiles.skills.listActive().map((skill): Descriptor => {
        const binding = settings.skillBindings.find((item) => item.skillId === skill.id)
        return {
          kind: 'skill',
          resourceId: skill.id,
          version: skill.version,
          fingerprint: profileContentHash({ profile: skill, binding }),
          check: () => this.checkSkill(skill, binding?.sourcePath)
        }
      }),
      ...this.options.profiles.mcpServers.listActive().map((profile): Descriptor => {
        const connection = settings.mcpConnections.find(
          (item) => item.connectionRef === profile.connectionRef
        )
        const secret = profile.credentialRef
          ? this.options.localSecrets.resolveSecret(profile.credentialRef)
          : undefined
        return {
          kind: 'mcp',
          resourceId: profile.id,
          version: profile.version,
          fingerprint: profileContentHash({
            profile,
            connection,
            secretHash: secret ? profileContentHash(secret) : undefined
          }),
          check: () => this.checkMcp(profile, settings.mcpConnections, secret)
        }
      }),
      ...this.options.profiles.knowledgeBases.listActive().map((profile): Descriptor => {
        const binding = settings.knowledgeBindings.find(
          (item) => item.knowledgeBaseProfileId === profile.id
        )
        return {
          kind: 'knowledge',
          resourceId: profile.id,
          version: profile.version,
          fingerprint: profileContentHash({ profile, binding }),
          check: () => this.checkKnowledge(profile, binding)
        }
      })
    ]
  }

  private async checkSkill(
    profile: ReturnType<ProfileCatalog['skills']['listActive']>[number],
    sourcePath: string | undefined
  ): Promise<ReturnType<Descriptor['check']> extends Promise<infer T> ? T : never> {
    const checkedAt = this.now()
    if (!sourcePath) return failure('invalid', checkedAt, 'skill.binding', 'skill_binding_missing')
    try {
      const validated = await validateSkillPackage(sourcePath)
      if (validated.contentDigest !== profile.contentDigest) {
        return failure('invalid', checkedAt, 'skill.digest', 'skill_content_changed')
      }
      const loaded = loadSkills({
        cwd: sourcePath,
        agentDir: sourcePath,
        skillPaths: [sourcePath],
        includeDefaults: false
      })
      const found = loaded.skills.some((skill) => resolve(skill.baseDir) === resolve(sourcePath))
      if (loaded.diagnostics.length > 0 || !found) {
        return failure('pi-incompatible', checkedAt, 'skill.pi-load', 'pi_skill_load_failed')
      }
      return { status: 'healthy', checkedAt, stage: 'skill.pi-load' }
    } catch (error) {
      return failure('invalid', checkedAt, 'skill.package', errorCode(error))
    }
  }

  private async checkMcp(
    profile: McpServerProfile,
    connections: readonly McpLocalConnection[],
    secret: string | undefined
  ): Promise<ReturnType<Descriptor['check']> extends Promise<infer T> ? T : never> {
    const checkedAt = this.now()
    let connection: McpLocalConnection | undefined
    try {
      connection = resolveMcpConnection(
        profile,
        connections,
        profile.credentialRef && secret ? { [profile.credentialRef]: secret } : {}
      )
      if (!connection) return failure('invalid', checkedAt, 'mcp.connection', 'mcp_connection_missing')
    } catch (error) {
      return failure('invalid', checkedAt, 'mcp.credentials', errorCode(error))
    }
    try {
      await (this.options.probeMcp ?? defaultMcpProbe)(profile, connection)
      return { status: 'healthy', checkedAt, stage: 'mcp.capabilities' }
    } catch (error) {
      return failure('pi-incompatible', checkedAt, 'mcp.capabilities', errorCode(error))
    }
  }

  private async checkKnowledge(
    profile: ReturnType<ProfileCatalog['knowledgeBases']['listActive']>[number],
    localBinding: ReturnType<MamLocalSettingsStore['get']>['knowledgeBindings'][number] | undefined
  ): Promise<ReturnType<Descriptor['check']> extends Promise<infer T> ? T : never> {
    const checkedAt = this.now()
    if (profile.kind === 'vector-store' || profile.kind === 'mcp-resource') {
      return failure(
        'pi-incompatible',
        checkedAt,
        'knowledge.connector',
        'knowledge_connector_kind_unsupported'
      )
    }
    const status = profile.kind === 'local-directory' && !localBinding ? 'degraded' : 'available'
    const resource = {
      binding: { knowledgeBaseProfileId: profile.id },
      profile,
      ...(localBinding ? { localBinding } : {}),
      status: status as 'available' | 'degraded'
    }
    try {
      const connector = new FileKnowledgeConnector(this.options.projectDirectory)
      const result = await connector.search(resource, {
        query: '__mam_health_probe__',
        topK: 1,
        maxContextTokens: 128
      })
      const match = isSearchResult(result) ? result.matches[0] : undefined
      if (match) await connector.read(resource, { documentRef: match.documentRef })
      return { status: 'healthy', checkedAt, stage: 'knowledge.read' }
    } catch (error) {
      return failure('invalid', checkedAt, 'knowledge.search', errorCode(error))
    }
  }
}

async function defaultMcpProbe(
  profile: McpServerProfile,
  connection: McpLocalConnection
): Promise<McpProbeResult> {
  const connector = new McpSdkConnector(() => connection, 30_000)
  try {
    return await connector.probe(profile)
  } finally {
    await connector.dispose()
  }
}

function failure(
  status: 'invalid' | 'pi-incompatible',
  checkedAt: string,
  stage: string,
  code: string
) {
  return { status, checkedAt, stage, code, message: healthMessage(stage) } as const
}

function healthMessage(stage: string): string {
  if (stage.startsWith('skill')) return 'The Skill could not be loaded through Pi.'
  if (stage.startsWith('mcp')) return 'The MCP server could not initialize or list capabilities.'
  return 'The Knowledge Base could not be searched through Pi.'
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) return String(error.code).slice(0, 120)
  const message = error instanceof Error ? error.message : String(error)
  return /^[a-z0-9_.-]+(?::|$)/i.exec(message)?.[0].replace(/:$/, '') ?? 'resource_probe_failed'
}

function healthKey(value: Pick<Descriptor, 'kind' | 'resourceId' | 'version'>): string {
  return `${value.kind}:${value.resourceId}:${value.version}`
}

function isSearchResult(value: unknown): value is { matches: { documentRef: string }[] } {
  return value !== null && typeof value === 'object' && 'matches' in value && Array.isArray(value.matches)
}

async function mapLimit<T, R>(
  values: readonly T[],
  limit: number,
  operation: (value: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = Array.from({ length: values.length })
  let next = 0
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next++
      results[index] = await operation(values[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()))
  return results
}
