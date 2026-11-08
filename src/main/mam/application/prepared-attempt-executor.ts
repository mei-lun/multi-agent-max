import { createAttemptCapabilityBridge } from './attempt-capability-bridge'
import type { AttemptExecutorEventObserver } from './attempt-executor-event-observer'
import {
  preparedAttemptGatewayAuthority,
  preparedAttemptResultAuthority
} from './prepared-attempt-authority'
import type { PreparedAttemptRunnerInput } from './mam-attempt-background-runner'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import { remainingPreparedAttemptRuntimeMs } from './prepared-attempt-draft'
import { monitorComponentClaim } from './component-claim-monitor'

export async function executePreparedAttempt(
  input: PreparedAttemptRunnerInput,
  prepared: PreparedAttempt,
  eventObserver: AttemptExecutorEventObserver
) {
  const executionTimeoutMs = remainingPreparedAttemptRuntimeMs(input.drafts, prepared)
  if (executionTimeoutMs <= 0) throw new Error('executor_timeout')
  if (prepared.task.component) {
    if (!input.componentExecutor) throw new Error('component_executor_unavailable')
    const component = structuredClone(prepared.task.component)
    if (!prepared.snapshot.tools.includes(`component:${component.id}`))
      throw new Error('component_permission_denied')
    if (
      prepared.snapshot.workflowRunId !== prepared.workflowRunId ||
      prepared.snapshot.taskId !== prepared.taskId ||
      prepared.snapshot.attemptId !== prepared.attemptId
    )
      throw new Error('component_authority_mismatch')
    if (/^(image|video|speech|text)\./.test(component.operation))
      component.params.modelProfileId = prepared.snapshot.modelProfile.id
    const authority = preparedAttemptResultAuthority(prepared, input.now())
    const monitor = monitorComponentClaim(input.repository, prepared, executionTimeoutMs)
    try {
      monitor.assertCurrent()
      const execution = await input.componentExecutor.execute({
        authority,
        snapshot: prepared.snapshot,
        component,
        nodeId: prepared.task.nodeId,
        workspace: prepared.worktree.path,
        projectDirectory: input.repository.projectDirectory,
        inputArtifacts: prepared.task.inputArtifacts,
        outputContracts: prepared.task.outputContracts,
        credentialValues: prepared.credentialValues,
        signal: monitor.signal
      })
      monitor.assertCurrent()
      if (!execution.result) throw new Error('component_structured_result_required')
      for (const key of [
        'workflowRunId',
        'nodeRunId',
        'taskId',
        'attemptId',
        'roleInstanceId',
        'executorInvocationId',
        'effectiveConfigHash'
      ] as const)
        if (execution.result.system[key] !== authority[key])
          throw new Error('component_result_authority_mismatch')
      return execution
    } finally {
      monitor.dispose()
    }
  }
  const capability = createAttemptCapabilityBridge({
    ...(input.componentTools ? { componentTools: input.componentTools } : {}),
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
