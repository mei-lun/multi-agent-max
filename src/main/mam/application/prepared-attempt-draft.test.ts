import { describe, expect, it, vi } from 'vitest'
import { FrozenExecutionContextSchema } from '../../../shared/mam/local-execution-draft'
import {
  accumulatedDraftRuntime,
  preparedAttemptDraft,
  remainingPreparedAttemptRuntimeMs
} from './prepared-attempt-draft'

describe('remainingPreparedAttemptRuntimeMs', () => {
  it('preserves the original Pi session directory and counts a resumed segment', () => {
    const parse = vi.spyOn(FrozenExecutionContextSchema, 'parse').mockReturnValue({} as never)
    try {
      const previous = {
        sessionDirectory: 'C:/original/sessions', activeRuntimeMs: 10_000,
        activeStartedAt: '2026-09-17T10:00:00Z', createdAt: '2026-09-17T09:00:00Z'
      }
      const prepared = {
        draftId: 'draft.1', attemptId: 'attempt.1', workflowRunId: 'run.1',
        taskId: 'task.1', claimId: 'claim.1', claimGeneration: 1,
        formalRevisionNumber: 0, roleInstanceId: 'role-instance.1',
        executorInvocationId: 'invocation.new',
        binding: { configRoot: 'C:/config' }, snapshot: { id: 'config.1',
          contentHash: 'a'.repeat(64) }, profile: { kind: 'pi-rpc' },
        worktree: { path: 'C:/worktree', branch: 'task', baseCommit: 'abcdef1' },
        resolvedConfig: {}, resources: {}
      }
      const saved = preparedAttemptDraft(prepared as never, 'waiting_for_resume',
        '2026-09-17T10:00:05Z', previous as never)
      expect(saved.sessionDirectory).toBe('C:/original/sessions')
      expect(saved.activeRuntimeMs).toBe(15_000)
    } finally {
      parse.mockRestore()
    }
  })
  it('uses the Draft cumulative active runtime across resumed invocations', () => {
    const store = { get: () => ({ activeRuntimeMs: 59_000 }) }
    const prepared = {
      draftId: 'draft.1',
      snapshot: { budget: { maxDurationSeconds: 60 } }
    }
    expect(remainingPreparedAttemptRuntimeMs(store as never, prepared as never)).toBe(1_000)
  })

  it('adds the active interval when a running Draft is paused', () => {
    expect(
      accumulatedDraftRuntime(
        {
          activeRuntimeMs: 10_000,
          activeStartedAt: '2026-09-17T10:00:00Z'
        } as never,
        '2026-09-17T10:00:05Z'
      )
    ).toBe(15_000)
  })

  it('defaults continuation attempts for older Draft records', () => {
    const store = { get: () => ({ activeRuntimeMs: 0 }) }
    const prepared = {
      draftId: 'draft.1',
      snapshot: { budget: { maxDurationSeconds: 60 } }
    }
    expect(remainingPreparedAttemptRuntimeMs(store as never, prepared as never)).toBe(60_000)
  })
})
