import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'

export function selectedRoleForTask(
  run: MamUiRunSnapshot,
  task: MamUiRunSnapshot['tasks'][number],
  participatingRoleProfileIds: readonly string[]
) {
  const roleProfileId = task.allowedRoleProfileIds[0]
  if (!roleProfileId || !participatingRoleProfileIds.includes(roleProfileId)) return undefined
  return run.run.roleCatalog.find((entry) => entry.roleProfileId === roleProfileId)
}

export function dependsOnBlockedTask(
  task: MamUiRunSnapshot['tasks'][number],
  run: MamUiRunSnapshot
): boolean {
  return task.dependencies.some((id) =>
    run.tasks.some((candidate) => candidate.id === id && candidate.status === 'needs_attention')
  )
}

export function hasOtherStartableTask(
  run: MamUiRunSnapshot,
  activeTaskId: string | undefined,
  manualRetryTaskIds: ReadonlySet<string>,
  participatingRoleProfileIds: readonly string[]
): boolean {
  return run.tasks.some(
    (task) =>
      task.id !== activeTaskId &&
      !manualRetryTaskIds.has(task.id) &&
      !task.activeClaim &&
      !dependsOnBlockedTask(task, run) &&
      (task.status === 'ready' || task.status === 'waiting_role_assignment') &&
      (task.status === 'ready'
        ? Boolean(task.roleProfileId && participatingRoleProfileIds.includes(task.roleProfileId))
        : Boolean(selectedRoleForTask(run, task, participatingRoleProfileIds))) &&
      !task.dependencies.includes(activeTaskId ?? '')
  )
}
