import { describe, expect, it, vi } from 'vitest'
import type {
  KnowledgeBaseProfile,
  McpServerProfile,
  RoleKnowledgeBaseBinding
} from '../../../shared/mam/domain/resource-profile'
import { EffectiveRoleConfigSnapshotSchema } from '../../../shared/mam/domain/role'
import { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import type { AttemptGatewayAuthority } from '../gateways/attempt-gateway-authority'
import type { KnowledgeConnector } from '../gateways/knowledge-gateway'
import type { McpConnector } from '../gateways/mcp-capability-gateway'
import type { ResolvedAttemptConfig } from '../profiles/attempt-config-resolver'
import { profileContentHash } from '../profiles/profile-content-hash'
import { AttemptResourceApplicationService } from './attempt-resource-application-service'
import { ExecutorCapabilityBridge } from './executor-capability-bridge'

describe('Executor capability bridge', () => {
  it('routes MCP and Knowledge calls through one Attempt-scoped Application API', async () => {
    const fixture = attemptFixture()
    const mcpConnector = {
      execute: vi.fn(async () => ({ tool: 'ok' })),
      dispose: vi.fn(async () => undefined)
    }
    const knowledgeConnector: KnowledgeConnector = {
      search: vi.fn(async () => ({ matches: ['scheduler.md'] })),
      read: vi.fn(async () => ({ content: 'Scheduler contract' }))
    }
    const diagnostics = new DiagnosticsRecorder()
    const application = new AttemptResourceApplicationService(
      fixture.config,
      fixture.authority,
      mcpConnector,
      knowledgeConnector,
      diagnostics
    )
    const bridge = new ExecutorCapabilityBridge(application, fixture.context)

    await expect(
      bridge.execute({
        method: 'mcp.execute',
        request: {
          serverProfileId: 'mcp.docs',
          operation: 'call_tool',
          toolId: 'mcp.search',
          arguments: { query: 'scheduler' }
        }
      })
    ).resolves.toEqual({ tool: 'ok' })
    await expect(
      bridge.execute({
        method: 'knowledge.search',
        request: {
          knowledgeBaseProfileId: 'knowledge.docs',
          collection: 'guides',
          query: 'scheduler',
          topK: 2
        }
      })
    ).resolves.toEqual({ matches: ['scheduler.md'] })
    await expect(
      bridge.execute({
        method: 'knowledge.read',
        request: {
          knowledgeBaseProfileId: 'knowledge.docs',
          collection: 'guides',
          documentRef: 'scheduler.md'
        }
      })
    ).resolves.toEqual({ content: 'Scheduler contract' })

    expect(mcpConnector.execute).toHaveBeenCalledWith(
      fixture.mcpProfile,
      expect.objectContaining({ context: fixture.context, toolId: 'mcp.search' })
    )
    expect(knowledgeConnector.search).toHaveBeenCalledWith(fixture.knowledgeResource, {
      query: 'scheduler',
      collection: 'guides',
      topK: 2,
      maxContextTokens: 1000
    })
    expect(knowledgeConnector.read).toHaveBeenCalledWith(fixture.knowledgeResource, {
      documentRef: 'scheduler.md',
      collection: 'guides'
    })
    expect(diagnostics.list().map((entry) => entry.payload.decision)).toEqual([
      'allow',
      'allow',
      'allow'
    ])

    await application.dispose()
    expect(mcpConnector.dispose).toHaveBeenCalledOnce()
  })

  it('does not let an Executor replace authority fields or cross Attempt boundaries', async () => {
    const fixture = attemptFixture()
    const mcpConnector: McpConnector = {
      execute: vi.fn(async () => ({ tool: 'ok' }))
    }
    const application = new AttemptResourceApplicationService(
      fixture.config,
      fixture.authority,
      mcpConnector,
      { search: vi.fn(), read: vi.fn() },
      new DiagnosticsRecorder()
    )
    const bridge = new ExecutorCapabilityBridge(application, fixture.context)
    const bridgeRequest = {
      method: 'mcp.execute',
      request: {
        serverProfileId: 'mcp.docs',
        operation: 'call_tool',
        toolId: 'mcp.search',
        arguments: {},
        context: { ...fixture.context, attemptId: 'attempt.foreign' }
      }
    }

    await expect(bridge.execute(bridgeRequest)).rejects.toMatchObject({ name: 'ZodError' })
    await expect(
      application.executeMcp({
        schemaVersion: '1.0.0',
        context: { ...fixture.context, attemptId: 'attempt.foreign' },
        serverProfileId: 'mcp.docs',
        operation: 'call_tool',
        toolId: 'mcp.search',
        arguments: {}
      })
    ).rejects.toMatchObject({ code: 'gateway_authority_mismatch' })
    expect(mcpConnector.execute).not.toHaveBeenCalled()
  })
})

function attemptFixture() {
  const mcpProfile: McpServerProfile = {
    id: 'mcp.docs',
    version: 2,
    displayName: 'Docs MCP',
    transport: 'stdio',
    connectionRef: 'connection.docs'
  }
  const knowledgeProfile: KnowledgeBaseProfile = {
    id: 'knowledge.docs',
    version: 3,
    displayName: 'Project docs',
    kind: 'local-directory',
    sourceRef: 'local.docs',
    indexRevision: 'index.7'
  }
  const knowledgeBinding: RoleKnowledgeBaseBinding = {
    knowledgeBaseProfileId: knowledgeProfile.id,
    collections: ['guides'],
    allowedOperations: ['search', 'read'],
    retrievalPolicy: { topK: 5, maxContextTokens: 1000 },
    required: true
  }
  const hash = 'a'.repeat(64)
  const ref = { id: 'profile', version: 1, contentHash: hash }
  const content = {
    schemaVersion: '1.0.0' as const,
    id: 'effective.bridge',
    workflowRunId: 'run.bridge',
    taskId: 'task.bridge',
    attemptId: 'attempt.bridge',
    roleProfile: { ...ref, id: 'role.bridge' },
    executorProfile: { ...ref, id: 'executor.pi', kind: 'pi-rpc' as const },
    providerProfile: { ...ref, id: 'provider.bridge' },
    modelProfile: { ...ref, id: 'model.bridge' },
    systemPromptRef: 'prompt.bridge',
    execution: {
      executableRef: 'executable.pi',
      adapterOptions: {},
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
        serverProfileId: mcpProfile.id,
        allowedTools: ['mcp.search'],
        allowedResources: [],
        allowedPrompts: [],
        version: mcpProfile.version,
        contentHash: profileContentHash(mcpProfile)
      }
    ],
    knowledgeBaseBindings: [
      {
        ...knowledgeBinding,
        version: knowledgeProfile.version,
        contentHash: profileContentHash(knowledgeProfile),
        indexRevision: 'index.7',
        status: 'available' as const
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
      maxOutputTokens: 2000,
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
    createdAt: '2026-07-28T12:00:00Z'
  }
  const snapshot = EffectiveRoleConfigSnapshotSchema.parse({
    ...content,
    contentHash: profileContentHash(content)
  })
  const authority: AttemptGatewayAuthority = {
    workflowRunId: snapshot.workflowRunId,
    nodeRunId: 'node-run.bridge',
    taskId: snapshot.taskId,
    attemptId: snapshot.attemptId,
    roleInstanceId: 'role-instance.bridge',
    executorInvocationId: 'executor-invocation.bridge',
    effectiveConfigHash: snapshot.contentHash
  }
  const { nodeRunId: _nodeRunId, ...context } = authority
  const knowledgeResource = {
    binding: knowledgeBinding,
    profile: knowledgeProfile,
    localBinding: {
      id: 'binding.knowledge.docs',
      knowledgeBaseProfileId: knowledgeProfile.id,
      bindingIdentity: 'machine.local',
      sourcePath: '/private/knowledge',
      indexRevision: 'index.7'
    },
    status: 'available' as const
  }
  const config: ResolvedAttemptConfig = {
    snapshot,
    skills: [],
    mcpResources: [
      {
        binding: {
          serverProfileId: mcpProfile.id,
          allowedTools: ['mcp.search'],
          allowedResources: [],
          allowedPrompts: []
        },
        profile: mcpProfile
      }
    ],
    knowledgeResources: [knowledgeResource]
  }
  return { config, authority, context, mcpProfile, knowledgeResource }
}
