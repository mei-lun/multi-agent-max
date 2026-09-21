import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import type { LocalExecutionDraftStore } from './local-execution-draft-store'
import type { LocalExecutionDraft } from '../../../shared/mam/local-execution-draft'
import { readPiSessionAssistantResponse } from '../executors/pi-assistant-response'

export function latestPiSessionFile(sessionDirectory: string): string | undefined {
  if (!existsSync(sessionDirectory)) return undefined
  return readdirSync(sessionDirectory)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => join(sessionDirectory, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0]
}

export function recoverablePiSessionText(draft: LocalExecutionDraft): string | undefined {
  if (draft.executorKind !== 'pi-rpc') return undefined
  const sessionFile = latestPiSessionFile(draft.sessionDirectory)
  if (!sessionFile) return undefined
  const selected = readPiSessionAssistantResponse(sessionFile)
  return selected.status === 'selected' ? selected.text : undefined
}

export function continuePreparedAttempt(
  prepared: PreparedAttempt,
  drafts: LocalExecutionDraftStore,
  executorInvocationId: string
): PreparedAttempt {
  const draft = prepared.draftId ? drafts.get(prepared.draftId) : undefined
  const sessionDirectory = draft?.sessionDirectory
  const resumeSessionFile = sessionDirectory ? latestPiSessionFile(sessionDirectory) : undefined
  const recoveredAssistantText =
    draft && prepared.task.reviewTask ? recoverablePiSessionText(draft) : undefined
  const requiresReviewRecovery = draft?.state === 'needs_attention' && prepared.task.reviewTask
  if (requiresReviewRecovery && !recoveredAssistantText) {
    throw new Error('review_output_recovery_unavailable')
  }
  if (prepared.profile.kind === 'pi-rpc' && !resumeSessionFile) {
    throw new Error('pi_session_unavailable')
  }
  return {
    ...prepared,
    executorInvocationId: recoveredAssistantText
      ? draft!.executorInvocationId
      : executorInvocationId,
    continuationAttempts: (draft?.continuationAttempts ?? 0) + 1,
    ...(resumeSessionFile ? { resumeSessionFile } : {}),
    ...(recoveredAssistantText ? { recoveredAssistantText } : {}),
    prompt: 'Continue the existing Task from the persisted session and current workspace state.'
  }
}
