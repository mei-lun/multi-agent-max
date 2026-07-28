import type { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import type { AttemptGatewayAuthority } from '../gateways/attempt-gateway-authority'
import {
  KnowledgeGateway,
  KnowledgeGatewayRequestSchema,
  type KnowledgeConnector
} from '../gateways/knowledge-gateway'
import { McpCapabilityGateway, type McpConnector } from '../gateways/mcp-capability-gateway'
import type { ResolvedAttemptConfig } from '../profiles/attempt-config-resolver'

export type AttemptResourceApplicationApi = Readonly<{
  executeMcp(input: unknown): Promise<unknown>
  searchKnowledge(input: unknown): Promise<unknown>
  readKnowledge(input: unknown): Promise<unknown>
}>

type ManagedMcpConnector = McpConnector & Readonly<{ dispose?: () => Promise<void> }>

export class AttemptResourceApplicationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AttemptResourceApplicationError'
  }
}

export class AttemptResourceApplicationService implements AttemptResourceApplicationApi {
  private readonly mcpGateway: McpCapabilityGateway
  private readonly knowledgeGateway: KnowledgeGateway

  constructor(
    config: ResolvedAttemptConfig,
    authority: AttemptGatewayAuthority,
    private readonly mcpConnector: ManagedMcpConnector,
    knowledgeConnector: KnowledgeConnector,
    diagnostics: DiagnosticsRecorder
  ) {
    this.mcpGateway = new McpCapabilityGateway(
      config.snapshot,
      config.mcpResources,
      authority,
      mcpConnector,
      diagnostics
    )
    this.knowledgeGateway = new KnowledgeGateway(
      config.snapshot,
      config.knowledgeResources,
      authority,
      knowledgeConnector,
      diagnostics
    )
  }

  executeMcp(input: unknown): Promise<unknown> {
    return this.mcpGateway.execute(input)
  }

  searchKnowledge(input: unknown): Promise<unknown> {
    assertKnowledgeOperation(input, 'search')
    return this.knowledgeGateway.execute(input)
  }

  readKnowledge(input: unknown): Promise<unknown> {
    assertKnowledgeOperation(input, 'read')
    return this.knowledgeGateway.execute(input)
  }

  async dispose(): Promise<void> {
    await this.mcpConnector.dispose?.()
  }
}

function assertKnowledgeOperation(input: unknown, expected: 'search' | 'read'): void {
  const request = KnowledgeGatewayRequestSchema.parse(input)
  if (request.operation !== expected) {
    throw new AttemptResourceApplicationError(
      'knowledge_method_mismatch',
      `knowledge.${expected} received a ${request.operation} request`
    )
  }
}
