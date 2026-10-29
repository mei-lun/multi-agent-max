import type { MamUiRunSnapshot } from '../../../shared/mam/ui-projection'
import type { WorkflowRunProjection } from '../state-store/git-state-projection'
import type { MamUiTaskDefinition } from './mam-ui-task-definitions'
import { currentTaskDeliveryAttemptId } from './current-task-delivery'

export function projectMamUiTasks(
  definitions: ReadonlyMap<string, MamUiTaskDefinition>,
  projection: WorkflowRunProjection,
  readyTaskIds: readonly string[]
): MamUiRunSnapshot['tasks'] {
  return [...new Set([...definitions.keys(), ...Object.keys(projection.tasks)])]
    .sort((left, right) => left.localeCompare(right))
    .map((id) => {
      const task = projection.tasks[id]
      const definition = definitions.get(id)
      const currentDeliveryAttemptId = currentTaskDeliveryAttemptId(task, projection.attempts)
      return {
        id,
        ...(definition?.nodeId ? { nodeId: definition.nodeId } : {}),
        title: definition?.title ?? id,
        ...(definition?.specification ? { specification: definition.specification } : {}),
        inputArtifacts: [...(definition?.inputArtifacts ?? [])],
        outputContracts: [...(definition?.outputContracts ?? [])],
        kind: definition?.kind ?? 'unknown',
        status:
          task?.status ??
          (readyTaskIds.includes(id)
            ? 'waiting_role_assignment'
            : (definition?.initialStatus ?? 'waiting_dependencies')),
        ...(task?.roleProfileId ? { roleProfileId: task.roleProfileId } : {}),
        ...(task?.roleProfileVersion ? { roleProfileVersion: task.roleProfileVersion } : {}),
        ...(task?.assignedByUserId ? { assignedByUserId: task.assignedByUserId } : {}),
        ...(task?.activeClaim ? { activeClaim: task.activeClaim } : {}),
        dependencies: [...(definition?.dependencies ?? [])],
        recommendedRoleProfileIds: [...(definition?.recommendedRoleProfileIds ?? [])],
        allowedRoleProfileIds: [...(definition?.allowedRoleProfileIds ?? [])],
        attemptIds: [...(task?.knownAttemptIds ?? [])],
        ...(currentDeliveryAttemptId ? { currentDeliveryAttemptId } : {}),
        ...(task?.selectedAttemptId ? { selectedAttemptId: task.selectedAttemptId } : {}),
        ...(definition?.reviewSubject ? { reviewSubject: definition.reviewSubject } : {}),
        reviewIds: [...(task?.reviewIds ?? [])],
        executionWarningCount: task?.executionWarnings.length ?? 0,
        ...(task?.reusedFrom ? { reusedFrom: task.reusedFrom } : {})
      }
    })
}
