import { join } from 'node:path'
import { MamImportCodexResourcesInputSchema } from '../../../shared/mam/resource-import'
import type { EncryptedLocalSecretStore } from '../application/encrypted-local-secret-store'
import type { MamUiQueryService } from '../application/mam-ui-query-service'
import type { ProfileCatalog } from '../profiles/profile-catalog'
import type { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'
import { CodexResourceDiscovery } from './codex-resource-discovery'
import { CodexResourceImporter } from './codex-resource-importer'
import { ResourceHealthChecker } from './resource-health-checker'
import { ResourceHealthStore } from './resource-health-store'

export function createDesktopResourceServices(input: {
  mamRoot: string
  profiles: ProfileCatalog
  localSettings: MamLocalSettingsStore
  localSecrets: EncryptedLocalSecretStore
  projectDirectory(): string
}) {
  const discovery = new CodexResourceDiscovery({
    profiles: input.profiles,
    localSettings: input.localSettings
  })
  const importer = new CodexResourceImporter({
    discovery,
    profiles: input.profiles,
    localSettings: input.localSettings,
    localSecrets: input.localSecrets,
    transactionPath: join(input.mamRoot, 'resource-import-transaction.json')
  })
  importer.recover()
  const health = new ResourceHealthChecker({
    profiles: input.profiles,
    localSettings: input.localSettings,
    localSecrets: input.localSecrets,
    projectDirectory: input.projectDirectory,
    store: new ResourceHealthStore(join(input.mamRoot, 'resource-health.json'))
  })
  return { discovery, importer, health }
}

export function createDesktopResourceOperations(
  resources: ReturnType<typeof createDesktopResourceServices>,
  query: MamUiQueryService,
  notifySnapshotChanged: () => void
) {
  return {
    listCodexResources: () => resources.discovery.list(),
    importCodexResources: async (input: unknown) => {
      await resources.importer.import(MamImportCodexResourcesInputSchema.parse(input))
      notifySnapshotChanged()
      return query.getSnapshot()
    },
    checkResourceHealth: async () => {
      await resources.health.checkAll()
      notifySnapshotChanged()
      return query.getSnapshot()
    }
  }
}
