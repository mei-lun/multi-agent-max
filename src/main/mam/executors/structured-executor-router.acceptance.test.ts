import { describe, expect, it } from 'vitest'
import type { EffectiveRoleConfigSnapshot } from '../../../shared/mam/domain/role'
import type { ExecutorProfile } from '../../../shared/mam/domain/execution-profile'
import { buildAttemptResult } from '../artifacts/attempt-result-builder'
import { profileContentHash } from '../profiles/profile-content-hash'
import {
  StructuredExecutorRouter,
  type StructuredExecutorInput,
  type StructuredExecutorResult
} from './structured-executor-router'

const kinds = ['codex-cli', 'grok-cli', 'pi-rpc'] as const

describe('mixed Executor Workflow acceptance', () => {
  it('routes three nodes in one Run with isolated Effective Config and result correlation', async () => {
    const calls = new Map<string, StructuredExecutorInput>()
    const adapter = (expected: (typeof kinds)[number]) => ({
      execute: async (input: StructuredExecutorInput) => {
        expect(input.snapshot.executorProfile.kind).toBe(expected)
        calls.set(expected, input)
        return executionResult(input)
      }
    })
    const router = new StructuredExecutorRouter(
      adapter('codex-cli'),
      adapter('grok-cli'),
      adapter('pi-rpc')
    )
    const results = await Promise.all(
      kinds.map((kind, index) => {
        const input = executionInput(kind, index + 1)
        return router.execute(input)
      })
    )

    expect([...calls.keys()].sort()).toEqual([...kinds].sort())
    expect(new Set([...calls.values()].map((input) => input.snapshot.contentHash)).size).toBe(3)
    expect(results.map((result) => result.result.system.workflowRunId)).toEqual([
      'run.mixed',
      'run.mixed',
      'run.mixed'
    ])
    expect(results.map((result) => result.result.system.taskId)).toEqual([
      'task.codex-cli',
      'task.grok-cli',
      'task.pi-rpc'
    ])
  })

  it('rejects a Profile kind that disagrees with the Attempt snapshot', async () => {
    const adapter = { execute: async (input: StructuredExecutorInput) => executionResult(input) }
    const router = new StructuredExecutorRouter(adapter, adapter, adapter)
    const input = executionInput('codex-cli', 1)
    await expect(
      router.execute({ ...input, profile: { ...input.profile, kind: 'pi-rpc' } })
    ).rejects.toThrow('executor_profile_snapshot_kind_mismatch')
  })
})

function executionInput(kind: (typeof kinds)[number], ordinal: number): StructuredExecutorInput {
  const snapshot = effectiveConfig(kind, ordinal)
  return {
    profile: {
      id: snapshot.executorProfile.id,
      version: 1,
      kind,
      executableRef: kind === 'pi-rpc' ? 'pi' : kind === 'grok-cli' ? 'grok' : 'codex',
      adapterOptions: {}
    },
    binding: {
      id: `binding.${kind}`,
      executorProfileId: snapshot.executorProfile.id,
      executablePath: '/usr/bin/false',
      configRoot: `/tmp/${kind}`,
      bindingIdentity: 'machine.test'
    },
    snapshot,
    resources: {
      attemptId: snapshot.attemptId,
      rootDirectory: `/tmp/${kind}`,
      configPath: `/tmp/${kind}/config.json`,
      manifestPath: `/tmp/${kind}/manifest.json`,
      skillDirectories: {},
      contentHash: snapshot.contentHash
    },
    executorInvocationId: `invocation.${kind}`,
    workspacePath: `/tmp/workspace-${kind}`,
    systemPrompt: `System prompt for ${kind}`,
    prompt: `Complete ${kind} task.`,
    credentialValues: {},
    authority: {
      workflowRunId: 'run.mixed',
      nodeRunId: `node-run.${kind}`,
      taskId: `task.${kind}`,
      attemptId: `attempt.${kind}`,
      roleInstanceId: `role-instance.${kind}`,
      executorInvocationId: `invocation.${kind}`,
      effectiveConfigHash: snapshot.contentHash,
      createdAt: '2026-07-28T20:00:00Z'
    }
  }
}

function effectiveConfig(
  kind: ExecutorProfile['kind'],
  ordinal: number
): EffectiveRoleConfigSnapshot {
  const reference = { id: `profile.${ordinal}`, version: 1, contentHash: 'a'.repeat(64) }
  const base = {
    schemaVersion: '1.0.0' as const,
    id: `effective.${kind}`,
    workflowRunId: 'run.mixed',
    taskId: `task.${kind}`,
    attemptId: `attempt.${kind}`,
    roleProfile: { ...reference, id: `role.${kind}` },
    executorProfile: { ...reference, id: `executor.${kind}`, kind },
    providerProfile: { ...reference, id: `provider.${kind}` },
    modelProfile: { ...reference, id: `model.${kind}` },
    systemPromptRef: `prompt.${kind}`,
    execution: {
      executableRef: kind,
      adapterOptions: {},
      providerProtocol: 'executor-native' as const,
      remoteModelId: `remote-model-${ordinal}`,
      modelCapabilities: {
        modalities: ['text' as const],
        supportsTools: true,
        supportsStructuredOutput: true
      },
      inference: { temperature: ordinal / 10 }
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
      allowedNetworkHosts: [],
      requireApprovalFor: []
    },
    budget: {
      maxInputTokens: 10_000,
      maxOutputTokens: 2_000,
      maxCostUsd: 1,
      maxDurationSeconds: 600
    },
    retry: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
    contextPolicy: {
      maxContextTokens: 10_000,
      compaction: 'disabled' as const,
      includePreviousAttempts: false
    },
    localBindingIds: [`binding.${kind}`],
    createdAt: '2026-07-28T20:00:00Z'
  }
  return { ...base, contentHash: profileContentHash(base) }
}

function executionResult(input: StructuredExecutorInput): StructuredExecutorResult {
  return {
    invocation: {} as StructuredExecutorResult['invocation'],
    events: [],
    usage: { status: 'unknown' },
    result: buildAttemptResult(
      {
        schemaVersion: '1.0.0',
        status: 'submitted',
        summary: `Completed ${input.profile.kind}.`,
        verifications: [],
        risks: [],
        followUps: [],
        artifacts: [],
        usage: { status: 'unknown' }
      },
      input.authority
    ),
    stderr: ''
  }
}
