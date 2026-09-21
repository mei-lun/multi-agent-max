import type { MamStartAttemptInput } from '../../../shared/mam/application-command'
import type { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'
import type { GitStateRepository } from '../state-store/git-state-repository'
import type { LocalExecutionDraftStore } from './local-execution-draft-store'
import { recoverablePiSessionText } from './pi-session-continuation'

export async function resumeAutomaticExecutionDrafts(input: {
  repository: GitStateRepository | undefined
  settings: MamLocalSettingsStore
  drafts: LocalExecutionDraftStore
  claimantInstanceId: string
  resumedDraftIds: Set<string>
  start(input: MamStartAttemptInput): Promise<unknown>
  onStateChanged(): void
}): Promise<void> {
  if (!input.repository) return
  const automaticRunIds = new Set(input.settings.get().automaticWorkflowRunIds ?? [])
  for (const draft of input.drafts.listUnfinished()) {
    if (
      !automaticRunIds.has(draft.workflowRunId) ||
      input.resumedDraftIds.has(draft.id) ||
      !canResume(input, draft)
    ) {
      continue
    }
    input.resumedDraftIds.add(draft.id)
    try {
      await input.start({
        workflowRunId: draft.workflowRunId,
        taskId: draft.taskId,
        ...(draft.state === 'needs_attention' ? { resumeNeedsAttention: true } : {})
      })
    } catch {
      input.onStateChanged()
    }
  }
}

function canResume(
  input: Pick<
    Parameters<typeof resumeAutomaticExecutionDrafts>[0],
    'repository' | 'claimantInstanceId'
  >,
  draft: ReturnType<LocalExecutionDraftStore['listUnfinished']>[number]
): boolean {
  const projection = input.repository!.rebuild(draft.workflowRunId)
  if (
    projection.tasks[draft.taskId]?.activeClaim?.claimantInstanceId !== input.claimantInstanceId
  ) {
    return false
  }
  if (draft.state === 'waiting_for_resume') {
    const retryLimit = draft.frozenExecution?.resolvedConfig.snapshot.retry.maxAttempts ?? 1
    return (draft.continuationAttempts ?? 0) + 1 < retryLimit
  }
  return (
    draft.state === 'needs_attention' &&
    Boolean(projection.reviewTasks[draft.taskId]) &&
    Boolean(recoverablePiSessionText(draft))
  )
}
