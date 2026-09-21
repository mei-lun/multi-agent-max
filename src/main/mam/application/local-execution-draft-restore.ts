import type { LocalExecutionDraft } from '../../../shared/mam/local-execution-draft'
import type { AttemptWorktree } from './attempt-worktree-manager'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import type { TaskClaim } from '../../../shared/mam/domain/task-claim'
import { latestPiSessionFile, recoverablePiSessionText } from './pi-session-continuation'

export function restoredAttemptIdentity(draft: LocalExecutionDraft) {
  return {
    attemptId: draft.attemptId,
    ...(draft.previousDeliveredAttemptId
      ? { previousAttemptId: draft.previousDeliveredAttemptId }
      : {})
  }
}

export function restoredWorktree(draft: LocalExecutionDraft): AttemptWorktree {
  return {
    path: draft.worktreePath,
    branch: draft.worktreeBranch,
    baseCommit: draft.baseCommit
  }
}

export function restoredPreparedFields(draft: LocalExecutionDraft, reviewTask = false) {
  const resumeSessionFile = latestPiSessionFile(draft.sessionDirectory)
  const recoveredAssistantText = reviewTask ? recoverablePiSessionText(draft) : undefined
  const requiresReviewRecovery = reviewTask && draft.state === 'needs_attention'
  if (requiresReviewRecovery && !recoveredAssistantText) {
    throw new Error('review_output_recovery_unavailable')
  }
  return {
    claimId: draft.claimId,
    claimGeneration: draft.claimGeneration,
    formalRevisionNumber: draft.formalRevisionNumber,
    continuationAttempts: draft.continuationAttempts ?? 0,
    roleInstanceId: draft.roleInstanceId,
    prompt: 'Continue the existing Task from the persisted session and current workspace state.',
    draftId: draft.id,
    ...(resumeSessionFile ? { resumeSessionFile } : {}),
    ...(recoveredAssistantText
      ? { recoveredAssistantText, executorInvocationId: draft.executorInvocationId }
      : {})
  }
}

export function restoredExecutionContext(
  draft: LocalExecutionDraft
): Pick<PreparedAttempt, 'profile' | 'binding' | 'resolvedConfig' | 'resources'> {
  const frozen = draft.frozenExecution
  if (!frozen) throw new Error('frozen_execution_context_unavailable')
  if (
    frozen.resolvedConfig.snapshot.id !== draft.effectiveConfigSnapshotId ||
    frozen.resolvedConfig.snapshot.contentHash !== draft.effectiveConfigHash ||
    frozen.resources.attemptId !== draft.attemptId ||
    frozen.resources.contentHash !== draft.effectiveConfigHash
  ) {
    throw new Error('frozen_execution_context_mismatch')
  }
  const knowledgeResources = frozen.resolvedConfig.knowledgeResources.map((resource) =>
    resource.localBinding
      ? { ...resource, localBinding: resource.localBinding }
      : {
          binding: resource.binding,
          profile: resource.profile,
          status: resource.status
        }
  )
  return {
    profile: frozen.profile,
    binding: frozen.binding,
    resolvedConfig: { ...frozen.resolvedConfig, knowledgeResources },
    resources: frozen.resources
  }
}

export function recoverableDraftForActiveClaim(input: {
  drafts: readonly LocalExecutionDraft[]
  workflowRunId: string
  taskId: string
  activeClaim: TaskClaim | undefined
  claimantInstanceId: string
}): LocalExecutionDraft | undefined {
  const claim = input.activeClaim
  if (!claim || claim.claimantInstanceId !== input.claimantInstanceId) return undefined
  return input.drafts.find(
    (draft) =>
      draft.workflowRunId === input.workflowRunId &&
      draft.taskId === input.taskId &&
      draft.claimId === claim.claimId &&
      draft.claimGeneration === claim.generation
  )
}

export function preparedAttemptMatchesActiveClaim(
  prepared: Pick<PreparedAttempt, 'claimId' | 'claimGeneration'> | undefined,
  activeClaim: TaskClaim | undefined,
  claimantInstanceId: string
): boolean {
  return Boolean(
    prepared &&
    activeClaim?.claimantInstanceId === claimantInstanceId &&
    prepared.claimId === activeClaim.claimId &&
    prepared.claimGeneration === activeClaim.generation
  )
}
