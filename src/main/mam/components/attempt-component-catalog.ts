import type { ComponentExecutionPort } from '../application/component-execution-port'
import type { MediaCatalog } from '../media'
import type { ModelProfile, ProviderProfile } from '../../../shared/mam/domain/execution-profile'
type Execution = Parameters<ComponentExecutionPort['execute']>[0]
export function frozenCatalog(input: Execution): {
  catalog: MediaCatalog
  resolveSecret(ref: string): string | undefined
} {
  const { snapshot } = input
  const provider: ProviderProfile = {
    id: snapshot.providerProfile.id,
    version: snapshot.providerProfile.version,
    protocol: snapshot.execution.providerProtocol,
    ...(snapshot.execution.providerBaseUrl ? { baseUrl: snapshot.execution.providerBaseUrl } : {}),
    ...(snapshot.execution.providerSecretRef
      ? { secretRef: snapshot.execution.providerSecretRef }
      : {}),
    ...(snapshot.execution.providerHeaders ? { headers: snapshot.execution.providerHeaders } : {})
  }
  const model: ModelProfile = {
    id: snapshot.modelProfile.id,
    version: snapshot.modelProfile.version,
    displayName: snapshot.execution.remoteModelId,
    providerProfileId: provider.id,
    remoteModelId: snapshot.execution.remoteModelId,
    capabilities: snapshot.execution.modelCapabilities,
    defaultInference: snapshot.execution.inference
  }
  return {
    catalog: {
      models: {
        getActive: (id) => (id === model.id ? model : undefined),
        listActive: () => [model]
      },
      providers: { getActive: (id) => (id === provider.id ? provider : undefined) }
    },
    resolveSecret: (ref) => input.credentialValues[ref]
  }
}
