import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import type { LocalExecutionDraft } from '../../../shared/mam/local-execution-draft'
import { FrozenExecutionContextSchema } from '../../../shared/mam/local-execution-draft'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import type { LocalExecutionDraftStore } from './local-execution-draft-store'

export function preparedAttemptDraft(
  prepared: PreparedAttempt,
  state: LocalExecutionDraft['state'],
  now: string,
  previous?: LocalExecutionDraft,
  errorCode?: string
): LocalExecutionDraft {
  const activeRuntimeMs = accumulatedDraftRuntime(previous, now)
  const invocationDirectory = join(
    resolve(prepared.binding.configRoot),
    'invocations',
    createHash('sha256').update(prepared.executorInvocationId).digest('hex')
  )
  return {
    schemaVersion: '1.0.0',
    id: prepared.draftId ?? `draft.${prepared.attemptId}`,
    workflowRunId: prepared.workflowRunId,
    taskId: prepared.taskId,
    claimId: prepared.claimId,
    claimGeneration: prepared.claimGeneration,
    attemptId: prepared.attemptId,
    ...(prepared.previousAttemptId
      ? { previousDeliveredAttemptId: prepared.previousAttemptId }
      : {}),
    formalRevisionNumber: prepared.formalRevisionNumber,
    roleInstanceId: prepared.roleInstanceId,
    executorInvocationId: prepared.executorInvocationId,
    effectiveConfigSnapshotId: prepared.snapshot.id,
    effectiveConfigHash: prepared.snapshot.contentHash,
    executorKind: prepared.profile.kind,
    invocationDirectory,
    sessionDirectory: join(invocationDirectory, 'sessions'),
    worktreePath: prepared.worktree.path,
    worktreeBranch: prepared.worktree.branch,
    baseCommit: prepared.worktree.baseCommit,
    state,
    frozenExecution: FrozenExecutionContextSchema.parse({
      profile: prepared.profile,
      binding: prepared.binding,
      resolvedConfig: prepared.resolvedConfig,
      resources: prepared.resources
    }),
    activeRuntimeMs,
    continuationAttempts: prepared.continuationAttempts ?? previous?.continuationAttempts ?? 0,
    ...(state === 'running' ? { activeStartedAt: now } : {}),
    ...(errorCode ? { lastErrorCode: errorCode, lastErrorAt: now } : {}),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now
  }
}

export function accumulatedDraftRuntime(
  previous: LocalExecutionDraft | undefined,
  now: string
): number {
  if (!previous?.activeStartedAt) return previous?.activeRuntimeMs ?? 0
  const elapsed = Math.max(0, Date.parse(now) - Date.parse(previous.activeStartedAt))
  return previous.activeRuntimeMs + elapsed
}

export function recordPreparedAttemptDraftState(input: {
  store: LocalExecutionDraftStore | undefined
  prepared: PreparedAttempt
  state: LocalExecutionDraft['state']
  at: string
  errorCode?: string
}): void {
  if (!input.store || !input.prepared.draftId) return
  const previous = input.store.get(input.prepared.draftId)
  input.store.save(
    preparedAttemptDraft(input.prepared, input.state, input.at, previous, input.errorCode)
  )
}

export function recordPreparedAttemptRunning(
  store: LocalExecutionDraftStore,
  prepared: PreparedAttempt,
  at: string
): void {
  if (!prepared.draftId) throw new Error('local_execution_draft_id_required')
  store.save(preparedAttemptDraft(prepared, 'running', at, store.get(prepared.draftId)))
}

export function remainingPreparedAttemptRuntimeMs(
  _store: LocalExecutionDraftStore | undefined,
  prepared: PreparedAttempt
): number {
  return prepared.snapshot.budget.maxDurationSeconds * 1000
}
