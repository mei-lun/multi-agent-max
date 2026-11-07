import type {
  StructuredExecutorInput,
  StructuredExecutorResult
} from '../executors/structured-executor-router'
import type { ComponentTaskDescriptor } from '../../../shared/mam/domain/component-task'
import type { ArtifactContract, ArtifactRef } from '../../../shared/mam/domain/artifact'
import type { ExecutorCapabilities } from '../../../shared/mam/domain/execution-profile'
export const componentHostCapabilities: ExecutorCapabilities = {
  supportedProtocols: [
    'openai-responses',
    'openai-completions',
    'anthropic-messages',
    'google-generative-ai',
    'executor-native'
  ],
  supportsCustomEndpoint: true,
  supportsModelOverride: true,
  supportsPerInstanceConfig: true,
  supportsPerInstanceCredentials: true,
  supportsSkills: false,
  supportedMcpTransports: [],
  supportsKnowledgeGateway: false,
  supportsStructuredOutput: true,
  supportsInvocationReconnect: false
}
export type ComponentExecutionPort = {
  execute(input: {
    authority: StructuredExecutorInput['authority']
    snapshot: StructuredExecutorInput['snapshot']
    component: ComponentTaskDescriptor
    workspace: string
    nodeId: string
    inputArtifacts: readonly ArtifactRef[]
    outputContracts: readonly ArtifactContract[]
    credentialValues: Readonly<Record<string, string>>
    signal: AbortSignal
  }): Promise<StructuredExecutorResult>
}
