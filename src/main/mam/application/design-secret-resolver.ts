import type { AttemptSecretValueProvider } from './local-attempt-secrets'
import type { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'

export function resolveDesignSecret(
  secretRef: string,
  settings: MamLocalSettingsStore,
  secretValues: AttemptSecretValueProvider
): string | undefined {
  const local = settings.get()
  const binding = local.secretBindings.find((candidate) => candidate.secretRef === secretRef) ?? {
    id: secretRef,
    secretRef,
    bindingIdentity: local.bindingIdentity
  }
  return secretValues.resolve(binding)
}
