import { randomUUID } from 'node:crypto'
import {
  MamSaveModelConnectionInputSchema,
  type MamSaveModelConnectionInput
} from '../../../shared/mam/application-command'
import { MamEntityIdSchema } from '../../../shared/mam/domain/primitives'
import type { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'
import type { MamLocalSecretWriter, MamUiWritableProfiles } from './mam-profile-write-ports'
import { normalizeOpenAiProviderBaseUrl } from './openai-provider-url'

export function saveModelConnectionProfiles(
  input: unknown,
  profiles: MamUiWritableProfiles,
  localSettings?: MamLocalSettingsStore,
  localSecrets?: MamLocalSecretWriter
): void {
  const parsed = MamSaveModelConnectionInputSchema.parse(input)
  const baseUrl = normalizedBaseUrl(parsed.protocol, parsed.baseUrl)
  const ids = connectionIds()
  requireSecretStorage(parsed, localSettings, localSecrets)
  if (parsed.apiKey) localSecrets!.save(ids.secretRef, parsed.apiKey)
  profiles.providers.save({
    id: ids.providerId,
    version: 1,
    protocol: parsed.protocol,
    ...(baseUrl ? { baseUrl } : {}),
    ...(parsed.apiKey ? { secretRef: ids.secretRef } : {})
  })
  profiles.models.save({
    id: ids.modelId,
    version: 1,
    displayName: parsed.displayName,
    providerProfileId: ids.providerId,
    remoteModelId: parsed.remoteModelId,
    ...(parsed.protocol === 'openai-responses' || parsed.protocol === 'openai-completions'
      ? { defaultInference: { reasoningEffort: 'medium' } }
      : {}),
    capabilities: {
      modalities: ['text'],
      supportsTools: true,
      supportsStructuredOutput: true,
      maxContextTokens: 100_000
    }
  })
  if (parsed.apiKey) saveSecretBinding(localSettings!, ids.secretRef)
}

function normalizedBaseUrl(
  protocol: MamSaveModelConnectionInput['protocol'],
  baseUrl: string | undefined
): string | undefined {
  if (!baseUrl || (protocol !== 'openai-responses' && protocol !== 'openai-completions')) {
    return baseUrl
  }
  return normalizeOpenAiProviderBaseUrl(baseUrl)
}

function requireSecretStorage(
  input: MamSaveModelConnectionInput,
  localSettings?: MamLocalSettingsStore,
  localSecrets?: MamLocalSecretWriter
): void {
  if (input.apiKey && (!localSettings || !localSecrets)) {
    throw new Error('Secure local secret storage is unavailable')
  }
}

function saveSecretBinding(settingsStore: MamLocalSettingsStore, secretRef: string): void {
  const settings = settingsStore.get()
  settingsStore.save({
    ...settings,
    secretBindings: [
      ...settings.secretBindings.filter((binding) => binding.secretRef !== secretRef),
      { id: secretRef, secretRef, bindingIdentity: settings.bindingIdentity }
    ]
  })
}

function connectionIds(): Readonly<{
  providerId: string
  modelId: string
  secretRef: string
}> {
  const suffix = randomUUID().replaceAll('-', '')
  return {
    providerId: MamEntityIdSchema.parse(`provider.${suffix}`),
    modelId: MamEntityIdSchema.parse(`model.${suffix}`),
    secretRef: MamEntityIdSchema.parse(`secret.${suffix}`)
  }
}
