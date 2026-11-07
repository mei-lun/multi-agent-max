import { resolveDesignSecret } from '../application/design-secret-resolver'
import type { AttemptSecretValueProvider } from '../application/local-attempt-secrets'
import type { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'
import type { MediaCatalog } from '../media'

export function desktopMediaDependencies(
  catalog: MediaCatalog,
  settings: MamLocalSettingsStore,
  secrets: AttemptSecretValueProvider
) {
  return { catalog, resolveSecret: (ref: string) => resolveDesignSecret(ref, settings, secrets) }
}
