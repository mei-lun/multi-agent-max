import { z } from 'zod'
import { MamEntityIdSchema } from '../../../shared/mam/domain/primitives'
import {
  GatewayRequestContextSchema,
  type GatewayRequestContext
} from '../gateways/attempt-gateway-authority'
import type { AttemptResourceApplicationApi } from './attempt-resource-application-service'
import type { AttemptHumanAttentionApplicationApi } from './attempt-human-attention-application-service'

const ExecutorMcpRequestSchema = z.discriminatedUnion('operation', [
  z
    .object({
      serverProfileId: MamEntityIdSchema,
      operation: z.literal('call_tool'),
      toolId: MamEntityIdSchema,
      arguments: z.record(z.string(), z.unknown())
    })
    .strict(),
  z
    .object({
      serverProfileId: MamEntityIdSchema,
      operation: z.literal('read_resource'),
      resourceUri: z.string().min(1)
    })
    .strict(),
  z
    .object({
      serverProfileId: MamEntityIdSchema,
      operation: z.literal('get_prompt'),
      promptId: MamEntityIdSchema,
      arguments: z.record(z.string(), z.string()).optional()
    })
    .strict()
])

const KnowledgeBaseRequestSchema = z.object({
  knowledgeBaseProfileId: MamEntityIdSchema,
  collection: z.string().min(1).optional()
})

export const ExecutorCapabilityBridgeRequestSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('mcp.execute'), request: ExecutorMcpRequestSchema }).strict(),
  z
    .object({
      method: z.literal('knowledge.search'),
      request: KnowledgeBaseRequestSchema.extend({
        query: z.string().min(1).max(20_000),
        topK: z.number().int().positive().optional(),
        maxContextTokens: z.number().int().positive().optional()
      }).strict()
    })
    .strict(),
  z
    .object({
      method: z.literal('knowledge.read'),
      request: KnowledgeBaseRequestSchema.extend({
        documentRef: z.string().min(1).max(4000)
      }).strict()
    })
    .strict(),
  z.object({ method: z.literal('human.request_input'), request: z.unknown() }).strict(),
  z.object({ method: z.literal('human.submit_understanding'), request: z.unknown() }).strict()
])

export type ExecutorCapabilityBridgeRequest = z.infer<typeof ExecutorCapabilityBridgeRequestSchema>

export class ExecutorCapabilityBridge {
  private readonly context: GatewayRequestContext

  constructor(
    private readonly applicationApi: AttemptResourceApplicationApi &
      Partial<AttemptHumanAttentionApplicationApi>,
    context: GatewayRequestContext
  ) {
    this.context = GatewayRequestContextSchema.parse(context)
  }

  async execute(input: unknown): Promise<unknown> {
    const request = ExecutorCapabilityBridgeRequestSchema.parse(input)
    const authorityFields = { schemaVersion: '1.0.0' as const, context: this.context }
    if (request.method === 'mcp.execute') {
      return this.applicationApi.executeMcp({ ...authorityFields, ...request.request })
    }
    if (request.method === 'knowledge.search') {
      return this.applicationApi.searchKnowledge({
        ...authorityFields,
        ...request.request,
        operation: 'search'
      })
    }
    if (request.method === 'human.request_input') {
      if (!this.applicationApi.requestHumanInput) throw new Error('human_attention_unavailable')
      return this.applicationApi.requestHumanInput(request.request)
    }
    if (request.method === 'human.submit_understanding') {
      if (!this.applicationApi.submitHumanUnderstanding)
        throw new Error('human_attention_unavailable')
      return this.applicationApi.submitHumanUnderstanding(request.request)
    }
    return this.applicationApi.readKnowledge({
      ...authorityFields,
      ...request.request,
      operation: 'read'
    })
  }
}
