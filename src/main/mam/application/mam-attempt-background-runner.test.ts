import { describe, expect, it, vi } from 'vitest'
import { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import { runPreparedAttempt } from './mam-attempt-background-runner'

describe('MAM Attempt background runner', () => {
  it('collects a recovered Review final answer without invoking the Executor', async () => {
    const execute = vi.fn()
    const validate = vi.fn(async (input: { contentOverrides?: ReadonlyMap<string, unknown> }) => {
      expect(input.contentOverrides?.get('artifact.review')).toBeDefined()
      throw new Error('stop_after_collection')
    })

    await runPreparedAttempt({
      prepared: recoveredReview(),
      executor: { execute },
      artifacts: { validate } as never,
      worktrees: {} as never,
      conflicts: {} as never,
      git: {} as never,
      repository: {} as never,
      diagnostics: new DiagnosticsRecorder(),
      schedulerId: 'scheduler.test',
      now: () => '2026-09-20T12:38:44.000Z',
      createId: (kind) => `${kind}.test`
    })

    expect(execute).not.toHaveBeenCalled()
    expect(validate).toHaveBeenCalledOnce()
  })
})

function recoveredReview(): PreparedAttempt {
  return {
    workflowRunId: 'run.review',
    taskId: 'review-task.one',
    attemptId: 'attempt.review',
    claimId: 'claim.review',
    claimGeneration: 1,
    formalRevisionNumber: 0,
    roleInstanceId: 'role-instance.review',
    executorInvocationId: 'executor-invocation.review',
    nodeId: 'review',
    task: {
      nodeRunId: 'node-run.review',
      nodeId: 'review',
      specification: 'Review the delivery.',
      inputArtifacts: [],
      outputContracts: [
        {
          schemaVersion: '1.0.0',
          artifactType: 'artifact.review',
          format: 'json-schema',
          required: true,
          maxBytes: 10_000,
          jsonSchema: { type: 'object' }
        }
      ],
      workspaceMode: 'read',
      baseRef: 'abcdef1',
      reviewTask: { id: 'review-task.one' } as never
    },
    profile: { kind: 'pi-rpc' } as never,
    binding: {
      executablePath: 'C:/mam/pi.js',
      configRoot: 'C:/mam/pi'
    } as never,
    snapshot: {
      executorProfile: { id: 'executor.pi', version: 1 },
      providerProfile: { id: 'provider.test', version: 1 },
      modelProfile: { id: 'model.test', version: 1 },
      execution: {
        providerProtocol: 'openai-responses',
        remoteModelId: 'gpt-test'
      },
      permissions: { writePaths: [] },
      budget: { maxDurationSeconds: 600 },
      contentHash: 'a'.repeat(64)
    } as never,
    resources: {} as never,
    resolvedConfig: {} as never,
    mcpConnections: [],
    credentialValues: {},
    systemPrompt: 'Review independently.',
    prompt: 'Review the delivery.',
    worktree: { path: 'C:/mam/review', branch: 'mam/review', baseCommit: 'abcdef1' },
    recoveredAssistantText: '审核通过，交付符合要求。'
  }
}
