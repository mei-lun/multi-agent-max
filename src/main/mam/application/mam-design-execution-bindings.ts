import type {
  ExecutorProfile,
  ExecutorKind,
  ProviderProtocol
} from '../../../shared/mam/domain/execution-profile'
import type { ProfileCatalog } from '../profiles/profile-catalog'

export type MamDesignExecutionBinding = Readonly<{
  executorProfileId: string
  modelProfileId: string
  providerProtocol: ProviderProtocol
}>

export type MamDesignExecutorResourceCapabilities = Readonly<{
  supportsSkills: boolean
  supportedMcpTransports: readonly ('stdio' | 'http' | 'sse')[]
  supportsKnowledgeGateway: boolean
}>

export function supportedDesignProviderProtocols(
  executor: ExecutorProfile
): readonly ProviderProtocol[] {
  if (executor.kind === 'codex-cli') return ['openai-responses']
  if (executor.kind === 'grok-cli') return ['openai-completions', 'executor-native']
  return ['openai-responses', 'openai-completions', 'anthropic-messages', 'google-generative-ai']
}

export function designExecutorResourceCapabilities(
  executor: ExecutorProfile | ExecutorKind
): MamDesignExecutorResourceCapabilities {
  const kind = typeof executor === 'string' ? executor : executor.kind
  if (kind === 'codex-cli') {
    return {
      supportsSkills: true,
      supportedMcpTransports: ['stdio', 'http'],
      supportsKnowledgeGateway: true
    }
  }
  if (kind === 'grok-cli') {
    return {
      supportsSkills: true,
      supportedMcpTransports: ['stdio'],
      supportsKnowledgeGateway: true
    }
  }
  return {
    supportsSkills: true,
    supportedMcpTransports: [],
    supportsKnowledgeGateway: false
  }
}

export function listMamDesignExecutionBindings(
  profiles: ProfileCatalog
): MamDesignExecutionBinding[] {
  const executors = profiles.executors.listActive()
  return profiles.models
    .listActive()
    .filter((model) => model.capabilities.supportsStructuredOutput)
    .flatMap((model) => {
      const provider = profiles.providers.getActive(model.providerProfileId)
      if (!provider) return []
      return executors
        .filter((executor) =>
          supportedDesignProviderProtocols(executor).includes(provider.protocol)
        )
        .map((executor) => ({
          executorProfileId: executor.id,
          modelProfileId: model.id,
          providerProtocol: provider.protocol
        }))
    })
    .sort((left, right) => bindingKey(left).localeCompare(bindingKey(right)))
}

export function preferredMamDesignExecutionBinding(
  profiles: ProfileCatalog,
  modelProfileId: string
): MamDesignExecutionBinding | undefined {
  const candidates = listMamDesignExecutionBindings(profiles).filter(
    (binding) => binding.modelProfileId === modelProfileId
  )
  return (
    candidates.find(
      (binding) => profiles.executors.getActive(binding.executorProfileId)?.kind === 'pi-rpc'
    ) ?? candidates[0]
  )
}

function bindingKey(binding: MamDesignExecutionBinding): string {
  return `${binding.modelProfileId}\u0000${binding.executorProfileId}`
}
