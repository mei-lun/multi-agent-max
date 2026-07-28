import type { SchedulerEvent } from '../../../shared/mam/scheduler-protocol'
import { profileContentHash } from '../profiles/profile-content-hash'

export class DynamicTaskEventValidationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'DynamicTaskEventValidationError'
  }
}

export function assertDynamicTaskEvent(
  event: Extract<SchedulerEvent, { type: 'dynamic_tasks_created' }>
): void {
  const planHash = profileContentHash(event.plan)
  if (
    event.plan.workflowRunId !== event.workflowRunId ||
    event.plan.sourceTaskId !== event.taskId ||
    event.plan.sourceAttemptId !== event.attemptId ||
    event.planArtifact.contentHash !== planHash ||
    event.planArtifact.workflowRunId !== event.workflowRunId ||
    event.planArtifact.nodeRunId !== event.plan.nodeRunId ||
    event.planArtifact.taskId !== event.taskId ||
    event.planArtifact.attemptId !== event.attemptId ||
    event.planArtifact.format !== 'json-schema' ||
    event.planArtifact.availability !== 'git' ||
    event.planArtifact.validationStatus !== 'valid'
  ) {
    fail('dynamic_task_event_mismatch', 'Dynamic Task event does not match its Plan Artifact')
  }
  const definitions = new Map(
    event.dynamicTasks.map((definition) => [definition.planItemId, definition])
  )
  if (definitions.size !== event.plan.tasks.length) {
    fail('dynamic_task_event_mismatch', 'Dynamic Task event does not cover each Plan item once')
  }
  for (const item of event.plan.tasks) {
    const definition = definitions.get(item.id)
    const dependencyIds = item.dependencies.map((dependency) => definitions.get(dependency)?.id)
    if (
      !definition ||
      definition.taskPlanId !== event.plan.id ||
      definition.taskPlanHash !== planHash ||
      definition.parentTaskId !== event.taskId ||
      definition.sourceAttemptId !== event.attemptId ||
      definition.workflowRunId !== event.workflowRunId ||
      definition.nodeRunId !== event.plan.nodeRunId ||
      definition.initialStatus !==
        (item.dependencies.length === 0 ? 'waiting_role_assignment' : 'waiting_dependencies') ||
      JSON.stringify(definition.dependencies) !== JSON.stringify(dependencyIds) ||
      JSON.stringify({
        title: definition.title,
        specification: definition.specification,
        inputArtifacts: definition.inputArtifacts,
        outputContracts: definition.outputContracts,
        recommendedRoleProfileIds: definition.recommendedRoleProfileIds,
        allowedRoleProfileIds: definition.allowedRoleProfileIds
      }) !==
        JSON.stringify({
          title: item.title,
          specification: item.specification,
          inputArtifacts: item.inputArtifacts,
          outputContracts: item.outputContracts,
          recommendedRoleProfileIds: item.recommendedRoleProfileIds,
          allowedRoleProfileIds: item.allowedRoleProfileIds
        })
    ) {
      fail('dynamic_task_event_mismatch', 'Dynamic Task definition has invalid lineage')
    }
  }
}

function fail(code: string, message: string): never {
  throw new DynamicTaskEventValidationError(code, message)
}
