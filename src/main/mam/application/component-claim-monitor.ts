import type { GitStateRepository } from '../state-store/git-state-repository'
import type { PreparedAttempt } from './mam-attempt-execution-types'
export function monitorComponentClaim(
  repository: GitStateRepository,
  prepared: PreparedAttempt,
  timeoutMs: number
) {
  const revoked = new AbortController()
  const check = () => {
    try {
      const task = repository.rebuild(prepared.workflowRunId).tasks[prepared.taskId]
      if (
        !task?.activeClaim ||
        task.activeClaim.claimId !== prepared.claimId ||
        task.activeClaim.generation !== prepared.claimGeneration ||
        ['cancelled', 'failed'].includes(task.status)
      )
        revoked.abort(new Error('component_claim_invalidated'))
    } catch {
      revoked.abort(new Error('component_claim_unavailable'))
    }
  }
  check()
  const timer = setInterval(check, 1000)
  const signal = AbortSignal.any([revoked.signal, AbortSignal.timeout(timeoutMs)])
  return {
    signal,
    assertCurrent: () => {
      check()
      signal.throwIfAborted()
    },
    dispose: () => clearInterval(timer)
  }
}
