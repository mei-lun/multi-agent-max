import { describe, expect, it, vi } from 'vitest'
import type {
  McpServerProfile,
  KnowledgeBaseProfile,
  RoleKnowledgeBaseBinding
} from '../../../shared/mam/domain/resource-profile'
import {
  EffectiveRoleConfigSnapshotSchema,
  type EffectiveRoleConfigSnapshot
} from '../../../shared/mam/domain/role'
import { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import type {
  ResolvedKnowledgeResource,
  ResolvedMcpResource
} from '../profiles/attempt-config-resolver'
import { profileContentHash } from '../profiles/profile-content-hash'
import type { AttemptGatewayAuthority } from './attempt-gateway-authority'
import { KnowledgeGateway, type KnowledgeConnector } from './knowledge-gateway'
import { McpCapabilityGateway, type McpConnector } from './mcp-capability-gateway'

describe('MCP capability gateway', () => {
  it('routes only the pinned Role tool allowlist and records an allow audit', async () => {
    const fixture = gatewayFixture()
    const connector: McpConnector = { execute: vi.fn(async () => ({ ok: true })) }
    const diagnostics = new DiagnosticsRecorder()
    const gateway = new McpCapabilityGateway(
      fixture.snapshot,
      [fixture.mcpResource],
      fixture.authority,
      connector,
      diagnostics
    )

    await expect(gateway.execute(mcpToolRequest(fixture))).resolves.toEqual({ ok: true })
    expect(connector.execute).toHaveBeenCalledWith(
      fixture.mcpProfile,
      expect.objectContaining({ operation: 'call_tool', toolId: 'mcp.search' })
    )
    expect(diagnostics.list()).toMatchObject([
      {
        kind: 'resource',
        payload: {
          resourceKind: 'mcp',
          decision: 'allow',
          operation: 'call_tool',
          target: 'mcp.search'
        }
      }
    ])
  })

  it('denies unlisted tools and mismatched Attempt authority before connector access', async () => {
    const fixture = gatewayFixture()
    const connector: McpConnector = { execute: vi.fn() }
    const diagnostics = new DiagnosticsRecorder()
    const gateway = new McpCapabilityGateway(
      fixture.snapshot,
      [fixture.mcpResource],
      fixture.authority,
      connector,
      diagnostics
    )

    await expect(
      gateway.execute({ ...mcpToolRequest(fixture), toolId: 'mcp.admin' })
    ).rejects.toMatchObject({ code: 'mcp_tool_denied' })
    await expect(
      gateway.execute({
        ...mcpToolRequest(fixture),
        context: { ...fixture.context, attemptId: 'attempt.other' }
      })
    ).rejects.toMatchObject({ code: 'gateway_authority_mismatch' })
    expect(connector.execute).not.toHaveBeenCalled()
    expect(diagnostics.list().map((event) => event.payload.decision)).toEqual(['deny', 'deny'])
  })

  it('keeps resource and prompt allowlists independent and honors approval policy', async () => {
    const fixture = gatewayFixture()
    const connector: McpConnector = { execute: vi.fn(async () => ({ ok: true })) }
    const diagnostics = new DiagnosticsRecorder()
    const gateway = new McpCapabilityGateway(
      fixture.snapshot,
      [fixture.mcpResource],
      fixture.authority,
      connector,
      diagnostics
    )

    await gateway.execute({
      schemaVersion: '1.0.0',
      context: fixture.context,
      serverProfileId: 'mcp.docs',
      operation: 'read_resource',
      resourceUri: 'docs://scheduler'
    })
    await gateway.execute({
      schemaVersion: '1.0.0',
      context: fixture.context,
      serverProfileId: 'mcp.docs',
      operation: 'get_prompt',
      promptId: 'prompt.explain'
    })
    await expect(
      gateway.execute({
        schemaVersion: '1.0.0',
        context: fixture.context,
        serverProfileId: 'mcp.docs',
        operation: 'read_resource',
        resourceUri: 'docs://private'
      })
    ).rejects.toMatchObject({ code: 'mcp_resource_denied' })

    const approvalSnapshot = withApproval(fixture.snapshot, 'mcp')
    const approvalAuthority = gatewayAuthority(approvalSnapshot)
    const approvalGateway = new McpCapabilityGateway(
      approvalSnapshot,
      [fixture.mcpResource],
      approvalAuthority,
      connector,
      diagnostics
    )
    await expect(
      approvalGateway.execute({
        ...mcpToolRequest(fixture),
        context: gatewayContext(approvalAuthority)
      })
    ).rejects.toMatchObject({ code: 'mcp_approval_required' })
    expect(connector.execute).toHaveBeenCalledTimes(2)
  })

  it('rejects a Profile whose versioned hash differs from the Effective Config', () => {
    const fixture = gatewayFixture()
    const changed = {
      ...fixture.mcpResource,
      profile: { ...fixture.mcpProfile, connectionRef: 'connection.changed' }
    }
    expect(
      () =>
        new McpCapabilityGateway(
          fixture.snapshot,
          [changed],
          fixture.authority,
          { execute: vi.fn() },
          new DiagnosticsRecorder()
        )
    ).toThrowError(expect.objectContaining({ code: 'mcp_profile_snapshot_mismatch' }))
  })
})

describe('Knowledge gateway', () => {
  it('applies pinned collection, filter and retrieval budgets without exposing local paths', async () => {
    const fixture = gatewayFixture()
    const connector: KnowledgeConnector = {
      search: vi.fn(async () => ({ matches: [] })),
      read: vi.fn()
    }
    const diagnostics = new DiagnosticsRecorder()
    const gateway = new KnowledgeGateway(
      fixture.snapshot,
      [fixture.knowledgeResource],
      fixture.authority,
      connector,
      diagnostics
    )
    const request = {
      schemaVersion: '1.0.0',
      context: fixture.context,
      knowledgeBaseProfileId: 'knowledge.docs',
      operation: 'search',
      collection: 'guides',
      query: 'How does the scheduler advance?',
      topK: 3,
      maxContextTokens: 800
    }

    await expect(gateway.execute(request)).resolves.toEqual({ matches: [] })
    expect(connector.search).toHaveBeenCalledWith(fixture.knowledgeResource, {
      query: request.query,
      collection: 'guides',
      topK: 3,
      maxContextTokens: 800,
      filters: { audience: ['developer'] }
    })
    const audit = diagnostics.list()[0]!
    expect(audit.payload).toMatchObject({
      decision: 'allow',
      operation: 'search',
      collection: 'guides'
    })
    expect(JSON.stringify(audit)).not.toContain(request.query)
    expect(JSON.stringify(audit)).not.toContain('/private/knowledge')
  })

  it('denies collection escapes, budget expansion and degraded resources', async () => {
    const fixture = gatewayFixture()
    const connector: KnowledgeConnector = { search: vi.fn(), read: vi.fn() }
    const diagnostics = new DiagnosticsRecorder()
    const gateway = new KnowledgeGateway(
      fixture.snapshot,
      [fixture.knowledgeResource],
      fixture.authority,
      connector,
      diagnostics
    )
    const request = knowledgeSearchRequest(fixture)

    await expect(gateway.execute({ ...request, collection: 'private' })).rejects.toMatchObject({
      code: 'knowledge_collection_denied'
    })
    await expect(gateway.execute({ ...request, topK: 6 })).rejects.toMatchObject({
      code: 'knowledge_budget_exceeded'
    })

    const degraded = degradedKnowledgeFixture()
    const degradedGateway = new KnowledgeGateway(
      degraded.snapshot,
      [degraded.knowledgeResource],
      degraded.authority,
      connector,
      diagnostics
    )
    await expect(degradedGateway.execute(knowledgeSearchRequest(degraded))).rejects.toMatchObject({
      code: 'knowledge_base_degraded'
    })
    expect(connector.search).not.toHaveBeenCalled()
  })
})

function gatewayFixture() {
  const mcpProfile: McpServerProfile = {
    id: 'mcp.docs',
    version: 2,
    displayName: 'Docs MCP',
    transport: 'stdio',
    connectionRef: 'connection.docs',
    credentialRef: 'secret.mcp'
  }
  const knowledgeProfile: KnowledgeBaseProfile = {
    id: 'knowledge.docs',
    version: 3,
    displayName: 'Project docs',
    kind: 'local-directory',
    sourceRef: 'local.docs',
    indexRevision: 'index.7'
  }
  const snapshot = effectiveSnapshot(mcpProfile, knowledgeProfile, 'available')
  const authority = gatewayAuthority(snapshot)
  return {
    snapshot,
    authority,
    context: gatewayContext(authority),
    mcpProfile,
    knowledgeProfile,
    mcpResource: {
      binding: {
        serverProfileId: 'mcp.docs',
        allowedTools: ['mcp.search'],
        allowedResources: ['docs://scheduler'],
        allowedPrompts: ['prompt.explain']
      },
      profile: mcpProfile
    } satisfies ResolvedMcpResource,
    knowledgeResource: {
      binding: knowledgeRoleBinding(),
      profile: knowledgeProfile,
      localBinding: {
        id: 'binding.knowledge.docs',
        knowledgeBaseProfileId: 'knowledge.docs',
        bindingIdentity: 'local.machine',
        sourcePath: '/private/knowledge',
        indexRevision: 'index.7'
      },
      status: 'available'
    } satisfies ResolvedKnowledgeResource
  }
}

function degradedKnowledgeFixture() {
  const fixture = gatewayFixture()
  const snapshot = effectiveSnapshot(fixture.mcpProfile, fixture.knowledgeProfile, 'degraded')
  const authority = gatewayAuthority(snapshot)
  return {
    ...fixture,
    snapshot,
    authority,
    context: gatewayContext(authority),
    knowledgeResource: {
      binding: knowledgeRoleBinding(),
      profile: fixture.knowledgeProfile,
      status: 'degraded' as const
    } satisfies ResolvedKnowledgeResource
  }
}

function effectiveSnapshot(
  mcpProfile: McpServerProfile,
  knowledgeProfile: KnowledgeBaseProfile,
  knowledgeStatus: 'available' | 'degraded'
): EffectiveRoleConfigSnapshot {
  const hash = 'a'.repeat(64)
  const ref = { id: 'profile', version: 1, contentHash: hash }
  const base = {
    schemaVersion: '1.0.0' as const,
    id: 'effective.gateway',
    workflowRunId: 'run.gateway',
    taskId: 'task.gateway',
    attemptId: 'attempt.gateway',
    roleProfile: { ...ref, id: 'role.gateway' },
    executorProfile: { ...ref, id: 'executor.codex', kind: 'codex-cli' as const },
    providerProfile: { ...ref, id: 'provider.gateway' },
    modelProfile: { ...ref, id: 'model.gateway' },
    systemPromptRef: 'prompt.gateway',
    execution: {
      executableRef: 'executable.codex',
      adapterOptions: { mode: 'headless' },
      providerProtocol: 'openai-responses' as const,
      remoteModelId: 'model-id',
      modelCapabilities: {
        modalities: ['text' as const],
        supportsTools: true,
        supportsStructuredOutput: true
      },
      inference: {}
    },
    skills: [],
    mcpBindings: [
      {
        serverProfileId: 'mcp.docs',
        allowedTools: ['mcp.search'],
        allowedResources: ['docs://scheduler'],
        allowedPrompts: ['prompt.explain'],
        version: mcpProfile.version,
        contentHash: profileContentHash(mcpProfile)
      }
    ],
    knowledgeBaseBindings: [
      {
        ...knowledgeRoleBinding(),
        version: knowledgeProfile.version,
        contentHash: profileContentHash(knowledgeProfile),
        indexRevision: 'index.7',
        status: knowledgeStatus
      }
    ],
    tools: ['mcp.search', 'knowledge.search', 'knowledge.read'],
    permissions: {
      readPaths: ['.'],
      writePaths: [],
      allowedCommands: [],
      deniedCommands: [],
      allowedNetworkHosts: [],
      requireApprovalFor: []
    },
    budget: {
      maxInputTokens: 10_000,
      maxOutputTokens: 2_000,
      maxCostUsd: 1,
      maxDurationSeconds: 60
    },
    retry: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
    contextPolicy: {
      maxContextTokens: 10_000,
      compaction: 'disabled' as const,
      includePreviousAttempts: false
    },
    localBindingIds: ['binding.knowledge.docs'],
    createdAt: '2026-07-28T10:00:00Z'
  }
  return EffectiveRoleConfigSnapshotSchema.parse({
    ...base,
    contentHash: profileContentHash(base)
  })
}

function knowledgeRoleBinding(): RoleKnowledgeBaseBinding {
  return {
    knowledgeBaseProfileId: 'knowledge.docs',
    collections: ['guides'],
    allowedOperations: ['search', 'read'],
    retrievalPolicy: {
      topK: 5,
      maxContextTokens: 1000,
      filters: { audience: ['developer'] }
    },
    required: false
  }
}

function gatewayAuthority(snapshot: EffectiveRoleConfigSnapshot): AttemptGatewayAuthority {
  return {
    workflowRunId: snapshot.workflowRunId,
    nodeRunId: 'node-run.gateway',
    taskId: snapshot.taskId,
    attemptId: snapshot.attemptId,
    roleInstanceId: 'role-instance.gateway',
    executorInvocationId: 'executor-invocation.gateway',
    effectiveConfigHash: snapshot.contentHash
  }
}

function gatewayContext(authority: AttemptGatewayAuthority) {
  const { nodeRunId: _nodeRunId, ...context } = authority
  return context
}

function withApproval(
  snapshot: EffectiveRoleConfigSnapshot,
  kind: 'mcp' | 'knowledge'
): EffectiveRoleConfigSnapshot {
  const { contentHash: _contentHash, ...content } = snapshot
  const next = {
    ...content,
    permissions: { ...content.permissions, requireApprovalFor: [kind] }
  }
  return EffectiveRoleConfigSnapshotSchema.parse({
    ...next,
    contentHash: profileContentHash(next)
  })
}

function mcpToolRequest(fixture: ReturnType<typeof gatewayFixture>) {
  return {
    schemaVersion: '1.0.0',
    context: fixture.context,
    serverProfileId: 'mcp.docs',
    operation: 'call_tool',
    toolId: 'mcp.search',
    arguments: { query: 'scheduler' }
  }
}

function knowledgeSearchRequest(fixture: { context: ReturnType<typeof gatewayContext> }) {
  return {
    schemaVersion: '1.0.0',
    context: fixture.context,
    knowledgeBaseProfileId: 'knowledge.docs',
    operation: 'search',
    collection: 'guides',
    query: 'scheduler'
  }
}
