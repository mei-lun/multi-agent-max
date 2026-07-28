import { z } from 'zod'
import { MamEntityIdSchema, MamSchemaVersionSchema } from '../../../shared/mam/domain/primitives'
import type { McpServerProfile } from '../../../shared/mam/domain/resource-profile'
import type { EffectiveRoleConfigSnapshot } from '../../../shared/mam/domain/role'
import type { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import type { ResolvedMcpResource } from '../profiles/attempt-config-resolver'
import { profileContentHash } from '../profiles/profile-content-hash'
import {
  GatewayRequestContextSchema,
  assertGatewayContext,
  type AttemptGatewayAuthority
} from './attempt-gateway-authority'

const McpRequestBaseSchema = z.object({
  schemaVersion: MamSchemaVersionSchema,
  context: GatewayRequestContextSchema,
  serverProfileId: MamEntityIdSchema
})

export const McpCapabilityRequestSchema = z.discriminatedUnion('operation', [
  McpRequestBaseSchema.extend({
    operation: z.literal('call_tool'),
    toolId: MamEntityIdSchema,
    arguments: z.record(z.string(), z.unknown())
  }).strict(),
  McpRequestBaseSchema.extend({
    operation: z.literal('read_resource'),
    resourceUri: z.string().min(1)
  }).strict(),
  McpRequestBaseSchema.extend({
    operation: z.literal('get_prompt'),
    promptId: MamEntityIdSchema,
    arguments: z.record(z.string(), z.string()).optional()
  }).strict()
])

export type McpCapabilityRequest = z.infer<typeof McpCapabilityRequestSchema>
export type McpConnector = Readonly<{
  execute(profile: McpServerProfile, request: McpCapabilityRequest): Promise<unknown>
}>

export class McpCapabilityGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'McpCapabilityGatewayError'
  }
}

export class McpCapabilityGateway {
  private readonly profiles = new Map<string, McpServerProfile>()

  constructor(
    private readonly snapshot: EffectiveRoleConfigSnapshot,
    resources: readonly ResolvedMcpResource[],
    private readonly authority: AttemptGatewayAuthority,
    private readonly connector: McpConnector,
    private readonly diagnostics: DiagnosticsRecorder
  ) {
    for (const resource of resources) {
      if (this.profiles.has(resource.profile.id)) {
        throw new McpCapabilityGatewayError(
          'duplicate_mcp_profile',
          `Duplicate MCP Profile ${resource.profile.id}`
        )
      }
      const binding = snapshot.mcpBindings.find(
        (candidate) => candidate.serverProfileId === resource.profile.id
      )
      if (
        !binding ||
        binding.version !== resource.profile.version ||
        binding.contentHash !== profileContentHash(resource.profile)
      ) {
        throw new McpCapabilityGatewayError(
          'mcp_profile_snapshot_mismatch',
          `MCP Profile ${resource.profile.id} does not match the Effective Config`
        )
      }
      this.profiles.set(resource.profile.id, resource.profile)
    }
  }

  async execute(input: unknown): Promise<unknown> {
    const request = McpCapabilityRequestSchema.parse(input)
    try {
      assertGatewayContext({
        context: request.context,
        authority: this.authority,
        snapshot: this.snapshot
      })
      const binding = this.snapshot.mcpBindings.find(
        (candidate) => candidate.serverProfileId === request.serverProfileId
      )
      if (!binding) deny('mcp_server_denied', 'MCP Server is outside the Role allowlist')
      const profile = this.profiles.get(request.serverProfileId)
      if (!profile) deny('mcp_profile_unavailable', 'MCP Profile is unavailable for this Attempt')
      if (this.snapshot.permissions.requireApprovalFor.includes('mcp')) {
        deny('mcp_approval_required', 'MCP access requires a Scheduler approval grant')
      }
      authorizeOperation(request, binding, this.snapshot.tools)
      const result = await this.connector.execute(profile, request)
      this.audit('allow', request)
      return result
    } catch (error) {
      this.audit('deny', request, errorCode(error))
      throw error
    }
  }

  private audit(decision: 'allow' | 'deny', request: McpCapabilityRequest, reason?: string): void {
    this.diagnostics.record({
      at: new Date().toISOString(),
      workflowRunId: this.authority.workflowRunId,
      nodeId: this.authority.nodeRunId,
      roleInstanceId: this.authority.roleInstanceId,
      executorInvocationId: this.authority.executorInvocationId,
      kind: 'resource',
      payload: {
        resourceKind: 'mcp',
        decision,
        operation: request.operation,
        serverProfileId: request.serverProfileId,
        target: requestTarget(request),
        ...(reason ? { reason } : {})
      }
    })
  }
}

function authorizeOperation(
  request: McpCapabilityRequest,
  binding: EffectiveRoleConfigSnapshot['mcpBindings'][number],
  roleTools: readonly string[]
): void {
  if (request.operation === 'call_tool') {
    if (!binding.allowedTools.includes(request.toolId) || !roleTools.includes(request.toolId)) {
      deny('mcp_tool_denied', `MCP tool ${request.toolId} is outside the Role allowlist`)
    }
    return
  }
  if (request.operation === 'read_resource') {
    if (!binding.allowedResources.includes(request.resourceUri)) {
      deny('mcp_resource_denied', 'MCP resource is outside the Role allowlist')
    }
    return
  }
  if (!binding.allowedPrompts.includes(request.promptId)) {
    deny('mcp_prompt_denied', `MCP prompt ${request.promptId} is outside the Role allowlist`)
  }
}

function requestTarget(request: McpCapabilityRequest): string {
  if (request.operation === 'call_tool') return request.toolId
  if (request.operation === 'read_resource') return request.resourceUri
  return request.promptId
}

function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error ? String(error.code) : 'gateway_error'
}

function deny(code: string, message: string): never {
  throw new McpCapabilityGatewayError(code, message)
}
