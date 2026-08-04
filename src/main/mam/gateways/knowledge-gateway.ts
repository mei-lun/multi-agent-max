import { createHash } from 'node:crypto'
import { z } from 'zod'
import { MamEntityIdSchema, MamSchemaVersionSchema } from '../../../shared/mam/domain/primitives'
import type { EffectiveRoleConfigSnapshot } from '../../../shared/mam/domain/role'
import type { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import type { ResolvedKnowledgeResource } from '../profiles/attempt-config-resolver'
import { profileContentHash } from '../profiles/profile-content-hash'
import {
  GatewayRequestContextSchema,
  assertGatewayContext,
  type AttemptGatewayAuthority
} from './attempt-gateway-authority'

const DEFAULT_SEARCH_RESULTS = 5
const MAX_SEARCH_RESULTS = 20
const DEFAULT_CONTEXT_TOKENS = 8_000

const KnowledgeRequestBaseSchema = z.object({
  schemaVersion: MamSchemaVersionSchema,
  context: GatewayRequestContextSchema,
  knowledgeBaseProfileId: MamEntityIdSchema,
  collection: z.string().min(1).optional()
})

export const KnowledgeGatewayRequestSchema = z.discriminatedUnion('operation', [
  KnowledgeRequestBaseSchema.extend({
    operation: z.literal('search'),
    query: z.string().min(1).max(20_000),
    topK: z.number().int().positive().optional(),
    maxContextTokens: z.number().int().positive().optional()
  }).strict(),
  KnowledgeRequestBaseSchema.extend({
    operation: z.literal('read'),
    documentRef: z.string().min(1).max(4000)
  }).strict()
])

export type KnowledgeGatewayRequest = z.infer<typeof KnowledgeGatewayRequestSchema>
export type KnowledgeSearchInput = Readonly<{
  query: string
  collection?: string
  topK: number
  maxContextTokens: number
  filters?: Readonly<Record<string, string | string[]>>
}>
export type KnowledgeReadInput = Readonly<{ documentRef: string; collection?: string }>
export type KnowledgeConnector = Readonly<{
  search(resource: ResolvedKnowledgeResource, input: KnowledgeSearchInput): Promise<unknown>
  read(resource: ResolvedKnowledgeResource, input: KnowledgeReadInput): Promise<unknown>
}>

export class KnowledgeGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'KnowledgeGatewayError'
  }
}

export class KnowledgeGateway {
  private readonly resources = new Map<string, ResolvedKnowledgeResource>()

  constructor(
    private readonly snapshot: EffectiveRoleConfigSnapshot,
    resources: readonly ResolvedKnowledgeResource[],
    private readonly authority: AttemptGatewayAuthority,
    private readonly connector: KnowledgeConnector,
    private readonly diagnostics: DiagnosticsRecorder
  ) {
    for (const resource of resources) {
      if (this.resources.has(resource.profile.id)) {
        throw new KnowledgeGatewayError(
          'duplicate_knowledge_profile',
          `Duplicate Knowledge Base ${resource.profile.id}`
        )
      }
      const binding = snapshot.knowledgeBaseBindings.find(
        (candidate) => candidate.knowledgeBaseProfileId === resource.profile.id
      )
      const actualIndexRevision =
        resource.localBinding?.indexRevision ?? resource.profile.indexRevision
      if (
        !binding ||
        binding.version !== resource.profile.version ||
        binding.contentHash !== profileContentHash(resource.profile) ||
        binding.status !== resource.status ||
        binding.indexRevision !== actualIndexRevision
      ) {
        throw new KnowledgeGatewayError(
          'knowledge_profile_snapshot_mismatch',
          `Knowledge Base ${resource.profile.id} does not match the Effective Config`
        )
      }
      this.resources.set(resource.profile.id, resource)
    }
  }

  async execute(input: unknown): Promise<unknown> {
    const request = KnowledgeGatewayRequestSchema.parse(input)
    try {
      assertGatewayContext({
        context: request.context,
        authority: this.authority,
        snapshot: this.snapshot
      })
      const binding = this.snapshot.knowledgeBaseBindings.find(
        (candidate) => candidate.knowledgeBaseProfileId === request.knowledgeBaseProfileId
      )
      if (!binding) deny('knowledge_base_denied', 'Knowledge Base is outside the Role allowlist')
      const resource = this.resources.get(request.knowledgeBaseProfileId)
      if (!resource) deny('knowledge_base_unavailable', 'Knowledge Base is unavailable')
      if (binding.status !== 'available' || resource.status !== 'available') {
        deny('knowledge_base_degraded', 'Knowledge Base is degraded for this Attempt')
      }
      if (this.snapshot.permissions.requireApprovalFor.includes('knowledge')) {
        deny('knowledge_approval_required', 'Knowledge access requires a Scheduler approval grant')
      }
      let result: unknown
      if (request.operation === 'search') {
        result = await this.connector.search(resource, {
          query: request.query,
          ...(request.collection ? { collection: request.collection } : {}),
          topK: Math.min(request.topK ?? DEFAULT_SEARCH_RESULTS, MAX_SEARCH_RESULTS),
          maxContextTokens: Math.min(
            request.maxContextTokens ?? DEFAULT_CONTEXT_TOKENS,
            this.snapshot.contextPolicy.maxContextTokens
          )
        })
      } else {
        result = await this.connector.read(resource, {
          documentRef: request.documentRef,
          ...(request.collection ? { collection: request.collection } : {})
        })
      }
      this.audit('allow', request)
      return result
    } catch (error) {
      this.audit('deny', request, errorCode(error))
      throw error
    }
  }

  private audit(
    decision: 'allow' | 'deny',
    request: KnowledgeGatewayRequest,
    reason?: string
  ): void {
    this.diagnostics.record({
      at: new Date().toISOString(),
      workflowRunId: this.authority.workflowRunId,
      nodeId: this.authority.nodeRunId,
      roleInstanceId: this.authority.roleInstanceId,
      executorInvocationId: this.authority.executorInvocationId,
      kind: 'resource',
      payload: {
        resourceKind: 'knowledge',
        decision,
        operation: request.operation,
        knowledgeBaseProfileId: request.knowledgeBaseProfileId,
        ...(request.collection ? { collection: request.collection } : {}),
        ...(request.operation === 'search'
          ? { queryHash: createHash('sha256').update(request.query).digest('hex') }
          : { documentRefHash: createHash('sha256').update(request.documentRef).digest('hex') }),
        ...(reason ? { reason } : {})
      }
    })
  }
}

function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error ? String(error.code) : 'gateway_error'
}

function deny(code: string, message: string): never {
  throw new KnowledgeGatewayError(code, message)
}
