import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  ExecutorProfile,
  LocalExecutorBinding
} from '../../../shared/mam/domain/execution-profile'
import type { EffectiveRoleConfigSnapshot } from '../../../shared/mam/domain/role'
import type { MaterializedAttemptResources } from '../profiles/attempt-resource-materializer'
import { profileContentHash } from '../profiles/profile-content-hash'
import { PiRpcAdapter } from './pi-rpc-adapter'

describe('Pi RPC real process', () => {
  it('runs the installed Pi CLI against a local provider through the standard Result API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mam-pi-real-process-'))
    const provider = await startProvider()
    try {
      const snapshot = effectiveSnapshot(provider.baseUrl)
      const adapter = new PiRpcAdapter()
      const execution = await adapter.execute({
        profile: executorProfile(),
        binding: executorBinding(root),
        snapshot,
        resources: resources(root, snapshot),
        executorInvocationId: 'executor-invocation.real-pi',
        workspacePath: root,
        systemPrompt: 'Return the exact structured JSON requested by the caller.',
        prompt: 'Complete the local integration task.',
        credentialValues: { 'secret.provider': 'mam-canary-secret-real-process' },
        authority: {
          workflowRunId: snapshot.workflowRunId,
          nodeRunId: 'node-run.real-pi',
          taskId: snapshot.taskId,
          attemptId: snapshot.attemptId,
          roleInstanceId: 'role-instance.real-pi',
          executorInvocationId: 'replaced',
          effectiveConfigHash: 'b'.repeat(64),
          createdAt: '2026-07-28T08:20:00Z'
        }
      })

      expect(execution.result).toMatchObject({
        status: 'submitted',
        summary: 'Local Pi RPC integration completed.',
        system: { executorInvocationId: 'executor-invocation.real-pi' }
      })
      expect(execution.events.some((event) => event.sourceEventType === 'agent_settled')).toBe(true)
      expect(provider.requestCount()).toBeGreaterThanOrEqual(1)
      expect(execution.stderr).not.toContain('mam-canary-secret')
    } finally {
      await provider.stop()
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})

function executorProfile(): ExecutorProfile {
  return {
    id: 'executor.pi',
    version: 1,
    kind: 'pi-rpc',
    executableRef: 'executable.pi',
    adapterOptions: { mode: 'rpc' }
  }
}

function executorBinding(root: string): LocalExecutorBinding {
  return {
    id: 'binding.pi',
    executorProfileId: 'executor.pi',
    executablePath: resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
    configRoot: join(root, 'executor-config'),
    bindingIdentity: 'local.machine'
  }
}

function resources(
  root: string,
  snapshot: EffectiveRoleConfigSnapshot
): MaterializedAttemptResources {
  return {
    attemptId: snapshot.attemptId,
    rootDirectory: join(root, 'resources'),
    configPath: join(root, 'resources', 'effective-config.json'),
    manifestPath: join(root, 'resources', 'resource-manifest.json'),
    skillDirectories: {},
    contentHash: snapshot.contentHash
  }
}

function effectiveSnapshot(baseUrl: string): EffectiveRoleConfigSnapshot {
  const hash = 'a'.repeat(64)
  const ref = { id: 'profile', version: 1, contentHash: hash }
  const base = {
    schemaVersion: '1.0.0' as const,
    id: 'effective.real-pi',
    workflowRunId: 'run.real-pi',
    taskId: 'task.real-pi',
    attemptId: 'attempt.real-pi',
    roleProfile: { ...ref, id: 'role.real-pi' },
    executorProfile: { ...ref, id: 'executor.pi', kind: 'pi-rpc' as const },
    providerProfile: { ...ref, id: 'provider.local' },
    modelProfile: { ...ref, id: 'model.local' },
    systemPromptRef: 'prompt.real-pi',
    execution: {
      executableRef: 'executable.pi',
      adapterOptions: { mode: 'rpc' },
      providerProtocol: 'openai-completions' as const,
      providerBaseUrl: baseUrl,
      providerSecretRef: 'secret.provider',
      remoteModelId: 'mam-local-model',
      modelCapabilities: {
        modalities: ['text' as const],
        supportsTools: true,
        supportsStructuredOutput: true
      },
      inference: { thinkingLevel: 'off' }
    },
    skills: [],
    mcpBindings: [],
    knowledgeBaseBindings: [],
    tools: [],
    permissions: {
      readPaths: ['.'],
      writePaths: ['.'],
      allowedCommands: [],
      deniedCommands: [],
      allowedNetworkHosts: ['127.0.0.1'],
      requireApprovalFor: []
    },
    budget: {
      maxInputTokens: 10_000,
      maxOutputTokens: 2_000,
      maxCostUsd: 1,
      maxDurationSeconds: 20
    },
    retry: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
    contextPolicy: {
      maxContextTokens: 10_000,
      compaction: 'disabled' as const,
      includePreviousAttempts: false
    },
    localBindingIds: ['binding.pi', 'binding.secret.provider'],
    createdAt: '2026-07-28T08:20:00Z'
  }
  return { ...base, contentHash: profileContentHash(base) }
}

async function startProvider(): Promise<{
  baseUrl: string
  requestCount: () => number
  stop: () => Promise<void>
}> {
  let requests = 0
  const server = createServer(async (request, response) => {
    await consumeRequest(request)
    if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
      response.writeHead(404).end()
      return
    }
    requests += 1
    const content = JSON.stringify({
      schemaVersion: '1.0.0',
      status: 'submitted',
      summary: 'Local Pi RPC integration completed.',
      verifications: [],
      risks: [],
      followUps: [],
      artifacts: [],
      usage: { status: 'unknown' }
    })
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(`data: ${JSON.stringify(chunk({ role: 'assistant' }, null))}\n\n`)
    response.write(`data: ${JSON.stringify(chunk({ content }, null))}\n\n`)
    response.write(`data: ${JSON.stringify({ ...chunk({}, 'stop'), usage: tokenUsage() })}\n\n`)
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('provider did not bind')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requestCount: () => requests,
    stop: () => closeServer(server)
  }
}

async function consumeRequest(request: AsyncIterable<unknown>): Promise<void> {
  for await (const _chunk of request) continue
}

function chunk(delta: Record<string, unknown>, finishReason: string | null) {
  return {
    id: 'chatcmpl-mam',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'mam-local-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  }
}

function tokenUsage() {
  return { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise()))
  )
}
