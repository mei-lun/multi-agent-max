import type { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import { FileKnowledgeConnector } from '../gateways/file-knowledge-connector'
import { McpSdkConnector } from '../gateways/mcp-sdk-connector'
import { resolveMcpConnection } from '../gateways/mcp-connection-resolver'
import type { GitStateRepository } from '../state-store/git-state-repository'
import { AttemptHumanAttentionApplicationService } from './attempt-human-attention-application-service'
import { AttemptResourceApplicationService } from './attempt-resource-application-service'
import { ExecutorCapabilityBridge } from './executor-capability-bridge'
import type { PreparedAttempt } from './mam-attempt-execution-types'

export function createAttemptCapabilityBridge(input: {
  prepared: PreparedAttempt
  repository: GitStateRepository
  diagnostics: DiagnosticsRecorder
  schedulerId: string
  authority: Readonly<{
    workflowRunId: string
    nodeRunId: string
    taskId: string
    attemptId: string
    roleInstanceId: string
    executorInvocationId: string
    effectiveConfigHash: string
  }>
  createId(kind: string): string
  now(): string
}): Readonly<{ bridge: ExecutorCapabilityBridge; dispose(): void }> {
  const resources = new AttemptResourceApplicationService(
    input.prepared.resolvedConfig,
    input.authority,
    new McpSdkConnector((profile) =>
      resolveMcpConnection(
        profile,
        input.prepared.mcpConnections,
        input.prepared.mcpCredentialValues ?? {}
      )
    ),
    new FileKnowledgeConnector(input.repository.projectDirectory),
    input.diagnostics
  )
  const human = new AttemptHumanAttentionApplicationService(
    input.repository,
    input.authority,
    input.schedulerId,
    () => input.createId('command'),
    input.now
  )
  const bridge = new ExecutorCapabilityBridge(
    {
      executeMcp: (request) => resources.executeMcp(request),
      searchKnowledge: (request) => resources.searchKnowledge(request),
      readKnowledge: (request) => resources.readKnowledge(request),
      requestHumanInput: (request) => human.requestHumanInput(request),
      submitHumanUnderstanding: (request) => human.submitHumanUnderstanding(request)
    },
    gatewayRequestContext(input.authority)
  )
  return { bridge, dispose: () => resources.dispose() }
}

function gatewayRequestContext(
  authority: Readonly<{
    workflowRunId: string
    taskId: string
    attemptId: string
    roleInstanceId: string
    executorInvocationId: string
    effectiveConfigHash: string
  }>
) {
  return {
    workflowRunId: authority.workflowRunId,
    taskId: authority.taskId,
    attemptId: authority.attemptId,
    roleInstanceId: authority.roleInstanceId,
    executorInvocationId: authority.executorInvocationId,
    effectiveConfigHash: authority.effectiveConfigHash
  }
}
