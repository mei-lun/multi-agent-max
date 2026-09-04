import {
  MamImportCodexResourcesInputSchema,
  type MamImportCodexResourcesInput
} from '../../../shared/mam/resource-import'
import type { MamLocalSettings } from '../../../shared/mam/local-settings'
import type { EncryptedLocalSecretStore } from '../application/encrypted-local-secret-store'
import type { ProfileCatalog } from '../profiles/profile-catalog'
import type { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'
import type { CodexResourceDiscovery, ResolvedCodexCandidate } from './codex-resource-discovery'
import { CodexResourceImportTransaction } from './codex-resource-import-transaction'

export type CodexResourceImporterOptions = Readonly<{
  discovery: CodexResourceDiscovery
  profiles: ProfileCatalog
  localSettings: MamLocalSettingsStore
  localSecrets: EncryptedLocalSecretStore
  transactionPath: string
  now?: () => string
}>

export class CodexResourceImporter {
  private readonly transaction: CodexResourceImportTransaction
  private readonly now: () => string

  constructor(private readonly options: CodexResourceImporterOptions) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.transaction = new CodexResourceImportTransaction(
      options.transactionPath,
      options.profiles,
      options.localSettings,
      options.localSecrets
    )
  }

  recover(): void {
    this.transaction.recover()
  }

  async import(input: MamImportCodexResourcesInput): Promise<void> {
    const parsed = MamImportCodexResourcesInputSchema.parse(input)
    const resources = await this.resolveSelected(parsed.candidateKeys)
    assertUniqueResources(resources)
    this.applyMissingSecrets(resources, parsed.missingSecrets)
    const changed = resources.filter((resource) => resource.candidate.importState !== 'current')
    const targets = changed.map((resource) => this.targetFor(resource))
    if (targets.length === 0) return
    this.transaction.begin(targets)
    try {
      this.stageProfiles(changed, targets)
      this.saveLocalState(changed)
      targets.forEach((target) => {
        const registry = target.kind === 'skill' ? this.options.profiles.skills : this.options.profiles.mcpServers
        registry.activate(target.id, target.stagedVersion)
      })
      this.transaction.commit()
    } catch (error) {
      this.transaction.rollback()
      throw error
    }
  }

  private async resolveSelected(keys: readonly string[]): Promise<ResolvedCodexCandidate[]> {
    const resources: ResolvedCodexCandidate[] = []
    for (const key of new Set(keys)) {
      const resolved = await this.options.discovery.resolve(key)
      if (!resolved) throw new Error(`mam_import_candidate_stale:${key}`)
      if (resolved.candidate.importState === 'unavailable') {
        throw new Error(`mam_import_candidate_unavailable:${resolved.candidate.resourceId}`)
      }
      resources.push(resolved)
    }
    return resources
  }

  private applyMissingSecrets(
    resources: readonly ResolvedCodexCandidate[],
    supplied: Readonly<Record<string, string>>
  ): void {
    for (const resource of resources) {
      if (resource.kind !== 'mcp') continue
      for (const name of resource.candidate.requiredSecretNames) {
        const value = supplied[name]
        if (!value) throw new Error(`mam_import_missing_secret:${name}`)
        const target = resource.missingCredentialTargets[name]
        if (!target) throw new Error(`mam_import_secret_target_missing:${name}`)
        if (target.kind === 'environment') resource.credentials.environment[target.key] = value
        else resource.credentials.headers[target.key] = value
      }
    }
  }

  private targetFor(resource: ResolvedCodexCandidate) {
    const registry = resource.kind === 'skill' ? this.options.profiles.skills : this.options.profiles.mcpServers
    const previous = registry.getActive(resource.candidate.resourceId)
    const versions = registry.listVersions(resource.candidate.resourceId)
    return {
      kind: resource.kind,
      id: resource.candidate.resourceId,
      stagedVersion: Math.max(0, ...versions.map((profile) => profile.version)) + 1,
      ...(previous ? { previousVersion: previous.version } : {})
    }
  }

  private stageProfiles(
    resources: readonly ResolvedCodexCandidate[],
    targets: readonly ReturnType<CodexResourceImporter['targetFor']>[]
  ): void {
    for (const resource of resources) {
      const target = targets.find((item) => item.id === resource.candidate.resourceId)!
      if (resource.kind === 'skill') {
        this.options.profiles.skills.save(
          {
            schemaVersion: '1.0.0',
            id: target.id,
            version: target.stagedVersion,
            name: resource.package.name,
            description: resource.package.description,
            supportedExecutors: resource.package.supportedExecutors ?? [
              'codex-cli',
              'grok-cli',
              'pi-rpc'
            ],
            contentDigest: resource.package.contentDigest,
            enabled: true,
            importedAt: this.now()
          },
          false
        )
      } else {
        this.options.profiles.mcpServers.save(
          { ...resource.profile, version: target.stagedVersion },
          false
        )
      }
    }
  }

  private saveLocalState(resources: readonly ResolvedCodexCandidate[]): void {
    let settings = this.options.localSettings.get()
    for (const resource of resources) {
      if (resource.kind === 'skill') settings = bindSkill(settings, resource)
      else settings = this.bindMcp(settings, resource)
    }
    this.options.localSettings.save(settings)
  }

  private bindMcp(
    settings: MamLocalSettings,
    resource: Extract<ResolvedCodexCandidate, { kind: 'mcp' }>
  ): MamLocalSettings {
    const credentialRef = resource.profile.credentialRef
    if (credentialRef) {
      this.options.localSecrets.save(credentialRef, JSON.stringify(resource.credentials))
    }
    return {
      ...settings,
      mcpConnections: [
        ...settings.mcpConnections.filter(
          (connection) => connection.connectionRef !== resource.profile.connectionRef
        ),
        resource.connection
      ],
      secretBindings: credentialRef
        ? [
            ...settings.secretBindings.filter((binding) => binding.secretRef !== credentialRef),
            { id: credentialRef, secretRef: credentialRef, bindingIdentity: settings.bindingIdentity }
          ]
        : settings.secretBindings
    }
  }
}

function bindSkill(
  settings: MamLocalSettings,
  resource: Extract<ResolvedCodexCandidate, { kind: 'skill' }>
): MamLocalSettings {
  const id = resource.candidate.resourceId
  return {
    ...settings,
    skillBindings: [
      ...settings.skillBindings.filter((binding) => binding.skillId !== id),
      {
        id: `binding.${id}`,
        skillId: id,
        sourcePath: resource.package.canonicalPath,
        bindingIdentity: settings.bindingIdentity
      }
    ]
  }
}

function assertUniqueResources(resources: readonly ResolvedCodexCandidate[]): void {
  const ids = new Set<string>()
  for (const resource of resources) {
    if (ids.has(resource.candidate.resourceId)) {
      throw new Error(`mam_import_resource_id_collision:${resource.candidate.resourceId}`)
    }
    ids.add(resource.candidate.resourceId)
  }
}
