import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { McpServerProfile } from '../../../shared/mam/domain/resource-profile'
import { EffectiveRoleConfigSnapshotSchema } from '../../../shared/mam/domain/role'
import { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import { profileContentHash } from '../profiles/profile-content-hash'
import type { AttemptGatewayAuthority } from './attempt-gateway-authority'
import { McpCapabilityGateway } from './mcp-capability-gateway'
import { McpSdkConnector } from './mcp-sdk-connector'

const serverFixture = resolve('src/main/mam/gateways/test-fixtures/mcp-stdio-server.mjs')

describe('MCP SDK connector', () => {
  it('routes pinned tool, resource and prompt requests over one real stdio session', async () => {
    const fixture = gatewayFixture()
    const resolver = vi.fn(async () => ({
      connectionRef: 'connection.docs',
      transport: 'stdio' as const,
      command: process.execPath,
      args: [serverFixture],
      cwd: process.cwd(),
      environment: { MAM_MCP_TEST_CANARY: 'isolated' }
    }))
    const connector = new McpSdkConnector(resolver, 5_000)
    const execute = vi.spyOn(connector, 'execute')
    const gateway = new McpCapabilityGateway(
      fixture.snapshot,
      [fixture.resource],
      fixture.authority,
      connector,
      new DiagnosticsRecorder()
    )

    try {
      const first = await gateway.execute(toolRequest(fixture))
      const second = await gateway.execute(toolRequest(fixture))
      await expect(
        gateway.execute({
          schemaVersion: '1.0.0',
          context: fixture.context,
          serverProfileId: fixture.profile.id,
          operation: 'read_resource',
          resourceUri: 'docs://scheduler'
        })
      ).resolves.toMatchObject({ contents: [{ text: 'Scheduler resource' }] })
      await expect(
        gateway.execute({
          schemaVersion: '1.0.0',
          context: fixture.context,
          serverProfileId: fixture.profile.id,
          operation: 'get_prompt',
          promptId: 'prompt.explain',
          arguments: { topic: 'attempts' }
        })
      ).resolves.toMatchObject({
        messages: [{ content: { text: 'Explain attempts' } }]
      })

      const firstPayload = toolPayload(first)
      const secondPayload = toolPayload(second)
      expect(firstPayload).toMatchObject({
        query: 'scheduler',
        canary: 'isolated',
        inheritedHome: ''
      })
      expect(secondPayload.pid).toBe(firstPayload.pid)
      expect(resolver).toHaveBeenCalledTimes(1)
      expect(execute).toHaveBeenCalledTimes(4)

      await expect(
        gateway.execute({ ...toolRequest(fixture), toolId: 'mcp.admin' })
      ).resolves.toMatchObject({ isError: true })
      expect(execute).toHaveBeenCalledTimes(5)
    } finally {
      await connector.dispose()
    }
  })

  it('fails closed for missing, mismatched and incompatible local connections', async () => {
    const fixture = gatewayFixture()
    const request = toolRequest(fixture)
    await expect(
      new McpSdkConnector(async () => undefined).execute(fixture.profile, request)
    ).rejects.toMatchObject({ code: 'mcp_connection_unavailable' })
    await expect(
      new McpSdkConnector(async () => ({
        connectionRef: 'connection.other',
        transport: 'stdio',
        command: process.execPath,
        args: [],
        environment: {}
      })).execute(fixture.profile, request)
    ).rejects.toMatchObject({ code: 'mcp_connection_mismatch' })
    await expect(
      new McpSdkConnector(async () => ({
        connectionRef: 'connection.docs',
        transport: 'http',
        url: 'https://example.invalid/mcp',
        headers: {}
      })).execute(fixture.profile, request)
    ).rejects.toMatchObject({ code: 'mcp_transport_mismatch' })
  })
})

function gatewayFixture() {
  const profile: McpServerProfile = {
    id: 'mcp.docs',
    version: 1,
    displayName: 'Docs MCP',
    transport: 'stdio',
    connectionRef: 'connection.docs'
  }
  const hash = 'a'.repeat(64)
  const ref = { id: 'profile', version: 1, contentHash: hash }
  const content = {
    schemaVersion: '1.0.0' as const,
    id: 'effective.mcp-test',
    workflowRunId: 'run.mcp-test',
    taskId: 'task.mcp-test',
    attemptId: 'attempt.mcp-test',
    roleProfile: { ...ref, id: 'role.mcp-test' },
    executorProfile: { ...ref, id: 'executor.codex', kind: 'codex-cli' as const },
    providerProfile: { ...ref, id: 'provider.test' },
    modelProfile: { ...ref, id: 'model.test' },
    systemPromptRef: 'prompt.system',
    execution: {
      executableRef: 'executable.codex',
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
        serverProfileId: profile.id,
        version: profile.version,
        contentHash: profileContentHash(profile)
      }
    ],
    knowledgeBaseBindings: [],
    tools: ['mcp.search'],
    permissions: {
      readPaths: ['.'],
      writePaths: [],
      allowedCommands: [],
      deniedCommands: [],
      allowedNetworkHosts: [],
      requireApprovalFor: []
    },
    budget: {
      maxInputTokens: 1000,
      maxOutputTokens: 1000,
      maxCostUsd: 1,
      maxDurationSeconds: 60
    },
    retry: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
    contextPolicy: {
      maxContextTokens: 2000,
      compaction: 'disabled' as const,
      includePreviousAttempts: false
    },
    localBindingIds: [],
    createdAt: '2026-07-28T12:00:00Z'
  }
  const snapshot = EffectiveRoleConfigSnapshotSchema.parse({
    ...content,
    contentHash: profileContentHash(content)
  })
  const authority: AttemptGatewayAuthority = {
    workflowRunId: snapshot.workflowRunId,
    nodeRunId: 'node-run.mcp-test',
    taskId: snapshot.taskId,
    attemptId: snapshot.attemptId,
    roleInstanceId: 'role-instance.mcp-test',
    executorInvocationId: 'executor-invocation.mcp-test',
    effectiveConfigHash: snapshot.contentHash
  }
  const { nodeRunId: _nodeRunId, ...context } = authority
  return {
    profile,
    snapshot,
    authority,
    context,
    resource: {
      binding: { serverProfileId: profile.id },
      profile
    }
  }
}

function toolRequest(fixture: ReturnType<typeof gatewayFixture>) {
  return {
    schemaVersion: '1.0.0' as const,
    context: fixture.context,
    serverProfileId: fixture.profile.id,
    operation: 'call_tool' as const,
    toolId: 'mcp.search',
    arguments: { query: 'scheduler' }
  }
}

function toolPayload(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ text: string }> }).content[0]!
  return JSON.parse(content.text) as Record<string, unknown>
}
