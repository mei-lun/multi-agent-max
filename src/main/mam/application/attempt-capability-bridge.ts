import type { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import { FileKnowledgeConnector } from '../gateways/file-knowledge-connector'
import { McpSdkConnector } from '../gateways/mcp-sdk-connector'
import { resolveMcpConnection } from '../gateways/mcp-connection-resolver'
import type { GitStateRepository } from '../state-store/git-state-repository'
import { AttemptHumanAttentionApplicationService } from './attempt-human-attention-application-service'
import { AttemptResourceApplicationService } from './attempt-resource-application-service'
import { ExecutorCapabilityBridge } from './executor-capability-bridge'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import type { ComponentToolPortFactory } from './component-tool-port'
import { ComponentToolGateway } from './component-tool-gateway'
import { monitorComponentClaim } from './component-claim-monitor'

export function createAttemptCapabilityBridge(input: {
  prepared: PreparedAttempt
  componentTools?: ComponentToolPortFactory
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
}): Readonly<{ bridge: ExecutorCapabilityBridge; dispose(): Promise<void> }> {
  const monitor = input.componentTools
    ? monitorComponentClaim(
        input.repository,
        input.prepared,
        input.prepared.snapshot.budget.maxDurationSeconds * 1000
      )
    : undefined
  const componentPort = input.componentTools?.({
    prepared: input.prepared,
    authority: input.authority,
    signal: monitor!.signal
  })
  const components = componentPort
    ? new ComponentToolGateway(
        input.prepared,
        input.authority,
        componentPort,
        monitor!.signal,
        (receipt) =>
          input.diagnostics.record({
            at: input.now(),
            workflowRunId: input.authority.workflowRunId,
            nodeId: input.prepared.task.nodeId,
            taskId: input.authority.taskId,
            attemptId: input.authority.attemptId,
            roleInstanceId: input.authority.roleInstanceId,
            executorInvocationId: input.authority.executorInvocationId,
            kind: 'policy',
            payload: receipt
          })
      )
    : undefined
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
      ...(components
        ? { componentExecute: (request: unknown) => components.execute(request) }
        : {}),
      searchKnowledge: (request) => resources.searchKnowledge(request),
      readKnowledge: (request) => resources.readKnowledge(request),
      requestHumanInput: (request) => human.requestHumanInput(request),
      submitHumanUnderstanding: (request) => human.submitHumanUnderstanding(request)
    },
    gatewayRequestContext(input.authority)
  )
  return {
    bridge,
    dispose: async () => {
      monitor?.dispose()
      await componentPort?.dispose()
      await resources.dispose()
    }
  }
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
