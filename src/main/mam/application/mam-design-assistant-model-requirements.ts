import type { ProfileCatalog } from '../profiles/profile-catalog'
import { failMamDesignAssistant } from './mam-design-assistant-error'

export type MamDesignSecretResolver = Readonly<{
  resolve(secretRef: string): string | undefined
}>

export function requireMamDesignTemplateModel(profiles: ProfileCatalog, modelProfileId: string) {
  const model = profiles.models.getActive(modelProfileId)
  if (!model) {
    failMamDesignAssistant(
      'design_model_not_found',
      `Model Profile is not active: ${modelProfileId}`
    )
  }
  const provider = profiles.providers.getActive(model.providerProfileId)
  if (!provider) {
    failMamDesignAssistant(
      'design_provider_not_found',
      `Provider Profile is not active: ${model.providerProfileId}`
    )
  }
  if (provider.protocol === 'executor-native') {
    failMamDesignAssistant(
      'design_provider_unsupported',
      'Design Assistant requires a direct Model Provider'
    )
  }
  if (!model.capabilities.supportsStructuredOutput) {
    failMamDesignAssistant(
      'design_model_unstructured',
      'Design Assistant requires structured model output'
    )
  }
  return { model, provider }
}

export function requireMamDesignModel(
  profiles: ProfileCatalog,
  secrets: MamDesignSecretResolver,
  modelProfileId: string
) {
  const { model, provider } = requireMamDesignTemplateModel(profiles, modelProfileId)
  const credential = provider.secretRef ? secrets.resolve(provider.secretRef) : undefined
  if (provider.secretRef && !credential) {
    failMamDesignAssistant(
      'design_secret_unavailable',
      `Credential is unavailable: ${provider.secretRef}`
    )
  }
  return { model, provider, ...(credential ? { credential } : {}) }
}
