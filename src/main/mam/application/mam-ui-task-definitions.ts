import type { ArtifactContract, ArtifactRef } from '../../../shared/mam/domain/artifact'
import type { ReviewSubject } from '../../../shared/mam/domain/review'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { MamUiRunSnapshot } from '../../../shared/mam/ui-projection'
import type { WorkflowRunProjection } from '../state-store/git-state-projection'

export type MamUiTaskDefinition = Readonly<{
  title: string
  specification: string
  inputArtifacts: readonly ArtifactRef[]
  outputContracts: readonly ArtifactContract[]
  kind: MamUiRunSnapshot['tasks'][number]['kind']
  initialStatus: 'waiting_dependencies' | 'waiting_role_assignment'
  dependencies: readonly string[]
  recommendedRoleProfileIds: readonly string[]
  allowedRoleProfileIds: readonly string[]
  reviewSubject?: ReviewSubject
}>

export function collectMamUiTaskDefinitions(
  bundle: WorkflowRunBundle,
  projection: WorkflowRunProjection
): ReadonlyMap<string, MamUiTaskDefinition> {
  const definitions = new Map<string, MamUiTaskDefinition>()
  for (const task of bundle.taskCatalog) {
    definitions.set(task.id, taskDefinition(task, 'static'))
  }
  for (const task of Object.values(projection.dynamicTasks)) {
    definitions.set(task.id, taskDefinition(task, 'dynamic'))
  }
  for (const task of Object.values(projection.reviewTasks)) {
    definitions.set(task.id, {
      ...taskDefinition(task, 'review'),
      dependencies: [],
      reviewSubject: task.subject
    })
  }
  for (const task of Object.values(projection.mergeConflictTasks)) {
    definitions.set(task.id, {
      title: `Resolve merge conflict for ${task.parentTaskId}`,
      specification: `Resolve pinned merge conflicts for ${task.queueEntryId}.`,
      inputArtifacts: [],
      outputContracts: [],
      kind: 'merge_conflict',
      initialStatus: task.initialStatus,
      dependencies: [task.parentTaskId],
      recommendedRoleProfileIds: task.recommendedRoleProfileIds,
      allowedRoleProfileIds: task.allowedRoleProfileIds
    })
  }
  return definitions
}

function taskDefinition(
  task: Readonly<{
    title: string
    specification: string
    inputArtifacts: readonly ArtifactRef[]
    outputContracts: readonly ArtifactContract[]
    initialStatus: 'waiting_dependencies' | 'waiting_role_assignment'
    dependencies?: readonly string[]
    recommendedRoleProfileIds: readonly string[]
    allowedRoleProfileIds: readonly string[]
  }>,
  kind: MamUiTaskDefinition['kind']
): MamUiTaskDefinition {
  return {
    title: task.title,
    specification: task.specification,
    inputArtifacts: task.inputArtifacts,
    outputContracts: task.outputContracts,
    kind,
    initialStatus: task.initialStatus,
    dependencies: task.dependencies ?? [],
    recommendedRoleProfileIds: task.recommendedRoleProfileIds,
    allowedRoleProfileIds: task.allowedRoleProfileIds
  }
}
