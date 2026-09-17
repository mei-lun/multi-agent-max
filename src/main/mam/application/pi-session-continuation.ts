import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import type { LocalExecutionDraftStore } from './local-execution-draft-store'

export function latestPiSessionFile(sessionDirectory: string): string | undefined {
  if (!existsSync(sessionDirectory)) return undefined
  return readdirSync(sessionDirectory)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => join(sessionDirectory, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0]
}

export function continuePreparedAttempt(
  prepared: PreparedAttempt,
  drafts: LocalExecutionDraftStore,
  executorInvocationId: string
): PreparedAttempt {
  const sessionDirectory = prepared.draftId
    ? drafts.get(prepared.draftId)?.sessionDirectory
    : undefined
  const resumeSessionFile = sessionDirectory ? latestPiSessionFile(sessionDirectory) : undefined
  if (prepared.profile.kind === 'pi-rpc' && !resumeSessionFile) {
    throw new Error('pi_session_unavailable')
  }
  return {
    ...prepared,
    executorInvocationId,
    ...(resumeSessionFile ? { resumeSessionFile } : {}),
    prompt: 'Continue the existing Task from the persisted session and current workspace state.'
  }
}
