import { createAttemptCapabilityBridge } from './attempt-capability-bridge'
import type { AttemptExecutorEventObserver } from './attempt-executor-event-observer'
import {
  preparedAttemptGatewayAuthority,
  preparedAttemptResultAuthority
} from './prepared-attempt-authority'
import type { PreparedAttemptRunnerInput } from './mam-attempt-background-runner'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import { remainingPreparedAttemptRuntimeMs } from './prepared-attempt-draft'

export async function executePreparedAttempt(
  input: PreparedAttemptRunnerInput,
  prepared: PreparedAttempt,
  eventObserver: AttemptExecutorEventObserver
) {
  const executionTimeoutMs = remainingPreparedAttemptRuntimeMs(input.drafts, prepared)
  if (executionTimeoutMs <= 0) throw new Error('executor_timeout')
  const capability = createAttemptCapabilityBridge({
    prepared,
    repository: input.repository,
    diagnostics: input.diagnostics,
    schedulerId: input.schedulerId,
    authority: preparedAttemptGatewayAuthority(prepared),
    createId: input.createId,
    now: input.now
  })
  return input.executor
    .execute({
      profile: prepared.profile,
      binding: prepared.binding,
      snapshot: prepared.snapshot,
      resources: prepared.resources,
      executorInvocationId: prepared.executorInvocationId,
      workspacePath: prepared.worktree.path,
      systemPrompt: prepared.systemPrompt,
      prompt: prepared.prompt,
      credentialValues: prepared.credentialValues,
      authority: preparedAttemptResultAuthority(prepared, input.now()),
      capabilityBridge: capability.bridge,
      executionTimeoutMs,
      onEvent: eventObserver.observe,
      ...(prepared.resumeSessionFile ? { resumeSessionFile: prepared.resumeSessionFile } : {})
    })
    .finally(capability.dispose)
}
