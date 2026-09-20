import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { LocalExecutionDraft } from '../../../shared/mam/local-execution-draft'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import { LocalExecutionDraftStore } from './local-execution-draft-store'
import { continuePreparedAttempt } from './pi-session-continuation'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('Pi session continuation', () => {
  it('preserves the original invocation only for deterministic Review recovery', async () => {
    const fixture = await recoveryFixture(reviewFinalAnswer())
    const continued = continuePreparedAttempt(
      prepared(true),
      fixture.store,
      'executor-invocation.new'
    )

    expect(continued).toMatchObject({
      executorInvocationId: 'executor-invocation.original',
      recoveredAssistantText: '审核通过，交付符合要求。'
    })
  })

  it('uses a new invocation for a non-Review continuation', async () => {
    const fixture = await recoveryFixture(reviewFinalAnswer())
    const continued = continuePreparedAttempt(
      prepared(false),
      fixture.store,
      'executor-invocation.new'
    )

    expect(continued.executorInvocationId).toBe('executor-invocation.new')
    expect(continued).not.toHaveProperty('recoveredAssistantText')
  })

  it('recovers a completed final answer left in a waiting Draft', async () => {
    const fixture = await recoveryFixture(reviewFinalAnswer(), 'waiting_for_resume')

    expect(
      continuePreparedAttempt(prepared(true), fixture.store, 'executor-invocation.new')
    ).toMatchObject({
      executorInvocationId: 'executor-invocation.original',
      recoveredAssistantText: '审核通过，交付符合要求。'
    })
  })

  it('refuses to call the model when Review recovery has no completed final answer', async () => {
    const fixture = await recoveryFixture({
      role: 'assistant',
      stopReason: 'aborted',
      content: [responseText('{"status":"approved"}', 'final_answer')]
    })

    expect(() =>
      continuePreparedAttempt(prepared(true), fixture.store, 'executor-invocation.new')
    ).toThrow('review_output_recovery_unavailable')
  })
})

async function recoveryFixture(
  message: unknown,
  state: LocalExecutionDraft['state'] = 'needs_attention'
) {
  const root = await mkdtemp(join(tmpdir(), 'mam-pi-continuation-'))
  directories.push(root)
  const sessionDirectory = join(root, 'sessions')
  await mkdir(sessionDirectory)
  await writeFile(
    join(sessionDirectory, 'review.jsonl'),
    `${JSON.stringify({ type: 'message', message })}\n`,
    'utf8'
  )
  const store = new LocalExecutionDraftStore(join(root, 'drafts'))
  store.save({ ...draft(sessionDirectory), state })
  return { store }
}

function prepared(review: boolean): PreparedAttempt {
  return {
    draftId: 'draft.attempt.review',
    executorInvocationId: 'executor-invocation.original',
    profile: { kind: 'pi-rpc' },
    task: review ? { reviewTask: { id: 'review-task.one' } } : {}
  } as unknown as PreparedAttempt
}

function draft(sessionDirectory: string): LocalExecutionDraft {
  return {
    schemaVersion: '1.0.0',
    id: 'draft.attempt.review',
    workflowRunId: 'run.review',
    taskId: 'review-task.one',
    claimId: 'claim.review',
    claimGeneration: 1,
    attemptId: 'attempt.review',
    formalRevisionNumber: 0,
    roleInstanceId: 'role-instance.review',
    executorInvocationId: 'executor-invocation.original',
    effectiveConfigSnapshotId: 'effective.review',
    effectiveConfigHash: 'a'.repeat(64),
    executorKind: 'pi-rpc',
    invocationDirectory: join(sessionDirectory, '..'),
    sessionDirectory,
    worktreePath: join(sessionDirectory, '..', 'worktree'),
    worktreeBranch: 'mam/attempt/review',
    baseCommit: 'abcdef1',
    state: 'needs_attention',
    activeRuntimeMs: 1,
    createdAt: '2026-09-20T12:36:58.000Z',
    updatedAt: '2026-09-20T12:38:44.000Z'
  }
}

function reviewFinalAnswer() {
  return {
    role: 'assistant',
    stopReason: 'stop',
    content: [
      responseText('Checking delivery.', 'commentary'),
      responseText('审核通过，交付符合要求。', 'final_answer')
    ]
  }
}

function responseText(text: string, phase: 'commentary' | 'final_answer') {
  return { type: 'text', text, textSignature: JSON.stringify({ version: 1, phase }) }
}
