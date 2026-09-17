import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalExecutionDraftStore } from './local-execution-draft-store'
import {
  preparedAttemptMatchesActiveClaim,
  recoverableDraftForActiveClaim
} from './local-execution-draft-restore'
import { discardSupersededLocalDrafts } from './superseded-local-draft-discard'

const roots: string[] = []
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
)

describe('LocalExecutionDraftStore', () => {
  it('persists a recoverable Draft without secret values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mam-local-draft-'))
    roots.push(root)
    const store = new LocalExecutionDraftStore(root)
    const saved = store.save(draft())
    expect(store.get(saved.id)).toEqual(saved)
    expect(store.listRecoverable()).toEqual([saved])
    expect(readFileSync(join(root, `${saved.id}.json`), 'utf8')).not.toContain('provider-secret')
  })

  it('does not list delivered Drafts as recoverable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mam-local-draft-'))
    roots.push(root)
    const store = new LocalExecutionDraftStore(root)
    store.save({ ...draft(), state: 'delivered' })
    expect(store.listRecoverable()).toEqual([])
  })

  it('removes a discarded Draft manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mam-local-draft-'))
    roots.push(root)
    const store = new LocalExecutionDraftStore(root)
    store.save(draft())
    store.remove('draft.1')
    expect(store.get('draft.1')).toBeUndefined()
  })

  it('requires explicit attention before an unknown failure can resume', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mam-local-draft-'))
    roots.push(root)
    const store = new LocalExecutionDraftStore(root)
    const saved = store.save({ ...draft(), state: 'needs_attention' })
    expect(store.listRecoverable()).toEqual([])
    expect(store.listUnfinished()).toEqual([saved])
  })

  it('does not restore a Draft after its Claim generation was fenced', () => {
    const retained = draft()
    expect(
      recoverableDraftForActiveClaim({
        drafts: [retained],
        workflowRunId: retained.workflowRunId,
        taskId: retained.taskId,
        claimantInstanceId: 'claimant.local',
        activeClaim: {
          schemaVersion: '1.0.0', claimId: 'claim.takeover', taskId: retained.taskId,
          roleProfileId: 'role.1', roleProfileVersion: 1, claimantInstanceId: 'claimant.local',
          generation: 2, claimedAt: '2026-09-17T10:02:00Z'
        }
      })
    ).toBeUndefined()
    expect(
      preparedAttemptMatchesActiveClaim(
        { claimId: retained.claimId, claimGeneration: retained.claimGeneration },
        {
          schemaVersion: '1.0.0', claimId: 'claim.takeover', taskId: retained.taskId,
          roleProfileId: 'role.1', roleProfileVersion: 1, claimantInstanceId: 'claimant.local',
          generation: 2, claimedAt: '2026-09-17T10:02:00Z'
        },
        'claimant.local'
      )
    ).toBe(false)
  })

  it('discards a superseded local manifest after takeover', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mam-local-draft-'))
    roots.push(root)
    const store = new LocalExecutionDraftStore(root)
    store.save(draft())
    discardSupersededLocalDrafts({
      store, worktrees: { abandon: () => true } as never, repositoryPath: root,
      workflowRunId: 'run.1', taskId: 'task.1', claimantInstanceId: 'claimant.local',
      activeClaim: {
        schemaVersion: '1.0.0', claimId: 'claim.takeover', taskId: 'task.1',
        roleProfileId: 'role.1', roleProfileVersion: 1, claimantInstanceId: 'claimant.local',
        generation: 2, claimedAt: '2026-09-17T10:02:00Z'
      }
    })
    expect(store.get('draft.1')).toBeUndefined()
  })
})

function draft() {
  return {
    schemaVersion: '1.0.0' as const,
    id: 'draft.1',
    workflowRunId: 'run.1',
    taskId: 'task.1',
    claimId: 'claim.1',
    claimGeneration: 1,
    attemptId: 'attempt.local',
    formalRevisionNumber: 0,
    roleInstanceId: 'role-instance.1',
    executorInvocationId: 'executor-invocation.1',
    effectiveConfigSnapshotId: 'effective.1',
    effectiveConfigHash: 'a'.repeat(64),
    executorKind: 'pi-rpc' as const,
    invocationDirectory: 'C:/mam/invocation',
    sessionDirectory: 'C:/mam/invocation/sessions',
    worktreePath: 'C:/mam/worktree',
    worktreeBranch: 'mam/attempt/local',
    baseCommit: 'abcdef1',
    state: 'waiting_for_resume' as const,
    activeRuntimeMs: 10_000,
    lastErrorCode: 'executor_timeout',
    lastErrorAt: '2026-09-17T10:01:00Z',
    createdAt: '2026-09-17T10:00:00Z',
    updatedAt: '2026-09-17T10:01:00Z'
  }
}
