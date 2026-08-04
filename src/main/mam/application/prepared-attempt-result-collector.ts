import type { ExecutorUsage } from '../../../shared/mam/executor-events'
import type { GitCommandClient } from '../state-store/git-command-client'
import { collectDirectAttemptResult, materializeDirectAttemptResult } from './direct-attempt-result'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import { collectWorkspaceAttemptResult } from './workspace-attempt-result'

export async function collectPreparedAttemptResult(input: {
  prepared: PreparedAttempt
  assistantText: string | null | undefined
  usage: ExecutorUsage
  git: GitCommandClient
  authority: Parameters<typeof collectDirectAttemptResult>[0]['authority']
}) {
  if (input.prepared.snapshot.permissions.writePaths.length === 0) {
    return collectDirectAttemptResult({
      text: input.assistantText,
      outputContracts: input.prepared.task.outputContracts,
      authority: input.authority,
      usage: input.usage
    })
  }
  try {
    return await collectWorkspaceAttemptResult({
      workspacePath: input.prepared.worktree.path,
      baseCommit: input.prepared.worktree.baseCommit,
      outputContracts: input.prepared.task.outputContracts,
      git: input.git,
      authority: input.authority,
      usage: input.usage
    })
  } catch (cause) {
    if (!canUseDirectFallback(input.prepared, input.assistantText, cause)) throw cause
    const direct = collectDirectAttemptResult({
      text: input.assistantText,
      outputContracts: input.prepared.task.outputContracts,
      authority: input.authority,
      usage: input.usage
    })
    await materializeDirectAttemptResult(
      input.prepared.worktree.path,
      input.prepared.task.outputContracts,
      direct.contents
    )
    return direct
  }
}

function canUseDirectFallback(
  prepared: PreparedAttempt,
  assistantText: string | null | undefined,
  cause: unknown
): boolean {
  if (!assistantText?.trim() || prepared.task.outputContracts.length !== 1) return false
  const format = prepared.task.outputContracts[0]!.format
  const message = cause instanceof Error ? cause.message : String(cause)
  return (
    message.startsWith('required_artifact_missing:') &&
    (format === 'markdown' || format === 'json-schema' || format === 'test-report')
  )
}
