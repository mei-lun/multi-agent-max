import { existsSync } from 'node:fs'
import type { LocalExecutionDraft } from '../../../shared/mam/local-execution-draft'
import { isRetryableConnectionFailure } from '../executors/pi-rpc-connection-failure'
import { latestPiSessionFile } from './pi-session-continuation'

export function requireLocalConnectionRetryDecision(
  draft: LocalExecutionDraft | undefined,
  confirmed: boolean | undefined
): void {
  if (draft?.state !== 'waiting_for_resume' || !isRetryableConnectionFailure(draft.lastErrorCode))
    return
  const retryLimit = draft.frozenExecution?.resolvedConfig.snapshot.retry.maxAttempts ?? 1
  if ((draft.continuationAttempts ?? 0) + 1 >= retryLimit && !confirmed) {
    throw new Error('local_connection_retry_requires_user')
  }
  const remainingMs =
    (draft.frozenExecution?.resolvedConfig.snapshot.budget.maxDurationSeconds ?? 0) * 1000 -
    draft.activeRuntimeMs
  if (remainingMs <= 65_000) throw new Error('attempt_budget_insufficient')
  if (!existsSync(draft.worktreePath)) throw new Error('attempt_worktree_unavailable')
  if (draft.executorKind === 'pi-rpc') {
    let sessionFile: string | undefined
    try {
      sessionFile = latestPiSessionFile(draft.sessionDirectory)
    } catch {
      throw new Error('pi_session_unavailable')
    }
    if (!sessionFile) throw new Error('pi_session_unavailable')
  }
}
