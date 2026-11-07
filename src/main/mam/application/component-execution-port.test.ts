import { test, expect, vi } from 'vitest'
import { executePreparedAttempt } from './prepared-attempt-executor'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import type { PreparedAttemptRunnerInput } from './mam-attempt-background-runner'
import type { AttemptExecutorEventObserver } from './attempt-executor-event-observer'
const prepared = () =>
  ({
    workflowRunId: 'run.1',
    taskId: 'task.1',
    attemptId: 'attempt.1',
    roleInstanceId: 'role.1',
    executorInvocationId: 'invocation.1',
    snapshot: {
      workflowRunId: 'run.1',
      taskId: 'task.1',
      attemptId: 'attempt.1',
      contentHash: 'a'.repeat(64),
      budget: { maxDurationSeconds: 1 },
      tools: ['component:creative.image'],
      modelProfile: { id: 'model.bound' }
    },
    task: {
      nodeId: 'node.1',
      nodeRunId: 'node-run.1',
      component: {
        id: 'creative.image',
        version: '1.0.0',
        hostApiVersion: '1.0.0',
        operation: 'image.generate',
        params: { modelProfileId: 'untrusted' }
      },
      inputArtifacts: [],
      outputContracts: []
    },
    worktree: { path: '.' },
    credentialValues: {}
  }) as unknown as PreparedAttempt
test('component route denies wrong authority and missing Role capability before dispatch', async () => {
  const execute = vi.fn(),
    input = {
      componentExecutor: { execute },
      now: () => ''
    } as unknown as PreparedAttemptRunnerInput
  const p = prepared()
  p.snapshot.tools.splice(0)
  await expect(
    executePreparedAttempt(input, p, {} as AttemptExecutorEventObserver)
  ).rejects.toThrow('permission_denied')
  const mismatch = { ...prepared(), attemptId: 'different' }
  await expect(
    executePreparedAttempt(input, mismatch, {} as AttemptExecutorEventObserver)
  ).rejects.toThrow('authority_mismatch')
  expect(execute).not.toHaveBeenCalled()
})
test('component route propagates failure and validates returned immutable authority', async () => {
  const repository = {
    rebuild: () => ({
      tasks: {
        'task.1': { activeClaim: { claimId: undefined, generation: undefined }, status: 'running' }
      }
    })
  }
  const input = {
    repository,
    componentExecutor: {
      execute: vi.fn(async () => {
        throw new Error('native failure')
      })
    },
    now: () => ''
  } as unknown as PreparedAttemptRunnerInput
  await expect(
    executePreparedAttempt(input, prepared(), {} as AttemptExecutorEventObserver)
  ).rejects.toThrow('native failure')
  const forged = {
    repository,
    componentExecutor: { execute: async () => ({ result: { system: { attemptId: 'other' } } }) },
    now: () => ''
  } as unknown as PreparedAttemptRunnerInput
  await expect(
    executePreparedAttempt(forged, prepared(), {} as AttemptExecutorEventObserver)
  ).rejects.toThrow('result_authority_mismatch')
})
