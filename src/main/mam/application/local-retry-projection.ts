import { existsSync } from 'node:fs'
import type { LocalExecutionDraft } from '../../../shared/mam/local-execution-draft'
import type { MamUiSnapshot } from '../../../shared/mam/ui-projection'
import type { WorkflowRunProjection } from '../state-store/git-event-projection'
import { isRetryableConnectionFailure } from '../executors/pi-rpc-connection-failure'
import { latestPiSessionFile } from './pi-session-continuation'

type RetryItem = MamUiSnapshot['localRetryItems'][number]

export function projectLocalRetryItems(input: {
  drafts: readonly LocalExecutionDraft[]
  workflowRunId: string
  projection: WorkflowRunProjection
  claimantInstanceId: string
}): RetryItem[] {
  return input.drafts.flatMap((draft) => {
    if (
      draft.workflowRunId !== input.workflowRunId ||
      draft.state !== 'waiting_for_resume' ||
      !isRetryableConnectionFailure(draft.lastErrorCode) ||
      (draft.continuationAttempts ?? 0) + 1 <
        (draft.frozenExecution?.resolvedConfig.snapshot.retry.maxAttempts ?? 1)
    ) {
      return []
    }
    const claim = input.projection.tasks[draft.taskId]?.activeClaim
    if (
      claim?.claimantInstanceId !== input.claimantInstanceId ||
      claim.claimId !== draft.claimId ||
      claim.generation !== draft.claimGeneration
    ) {
      return []
    }
    const availableRuntimeMs =
      (draft.frozenExecution?.resolvedConfig.snapshot.budget.maxDurationSeconds ?? 0) * 1000 -
      draft.activeRuntimeMs
    const reason =
      draft.executorKind !== 'pi-rpc'
        ? 'This Executor cannot continue its local session. Open Run recovery to inspect this Task.'
        : !existsSync(draft.worktreePath)
          ? 'The retained worktree is unavailable. Open Run recovery to inspect this Task.'
          : !hasPiSession(draft.sessionDirectory)
            ? 'The Pi session is unavailable. Open Run recovery to inspect this Task.'
            : availableRuntimeMs <= 65_000
              ? 'The Attempt runtime budget is exhausted. Open Run recovery to inspect this Task.'
              : undefined
    return [
      {
        workflowRunId: draft.workflowRunId,
        taskId: draft.taskId,
        draftId: draft.id,
        errorCode: draft.lastErrorCode!,
        occurredAt: draft.lastErrorAt ?? draft.updatedAt,
        automaticRetriesUsed: draft.continuationAttempts ?? 0,
        automaticRetryLimit: draft.frozenExecution?.resolvedConfig.snapshot.retry.maxAttempts ?? 1,
        canRetry: !reason,
        ...(reason ? { unavailableReason: reason } : {})
      }
    ]
  })
}

function hasPiSession(directory: string): boolean {
  try {
    return Boolean(latestPiSessionFile(directory))
  } catch {
    return false
  }
}
