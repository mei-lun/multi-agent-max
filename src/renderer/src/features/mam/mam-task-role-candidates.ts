import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'

export type MamTaskRoleCandidate = Readonly<{
  roleProfileId: string
  roleProfileVersion: number
  displayName: string
  recommended: boolean
}>

export function taskRoleCandidates(
  run: MamUiRunSnapshot,
  task: MamUiRunSnapshot['tasks'][number]
): readonly MamTaskRoleCandidate[] {
  const allowed = new Set(task.allowedRoleProfileIds)
  return run.run.roleCatalog
    .filter(
      (entry) =>
        (allowed.size === 0 || allowed.has(entry.roleProfileId)) &&
        (entry.roleProfileId !== task.roleProfileId ||
          entry.roleProfileVersion !== task.roleProfileVersion)
    )
    .map((entry) => ({
      roleProfileId: entry.roleProfileId,
      roleProfileVersion: entry.roleProfileVersion,
      displayName: frozenRoleName(run, entry.roleProfileId, entry.roleProfileVersion),
      recommended: task.recommendedRoleProfileIds.includes(entry.roleProfileId)
    }))
    .sort(
      (left, right) =>
        Number(right.recommended) - Number(left.recommended) ||
        left.displayName.localeCompare(right.displayName) ||
        left.roleProfileId.localeCompare(right.roleProfileId) ||
        left.roleProfileVersion - right.roleProfileVersion
    )
}

export function frozenRoleName(
  run: MamUiRunSnapshot,
  roleProfileId: string,
  roleProfileVersion: number
): string {
  return (
    run.roleProfiles.find(
      (role) => role.id === roleProfileId && role.version === roleProfileVersion
    )?.displayName ?? roleProfileId
  )
}

export function taskRoleChangeBlockReason(
  run: MamUiRunSnapshot,
  task: MamUiRunSnapshot['tasks'][number]
): string | undefined {
  const hasActiveAttempt = run.attempts.some(
    (attempt) =>
      attempt.taskId === task.id && (attempt.status === 'announced' || attempt.status === 'running')
  )
  if (hasActiveAttempt) return 'Recover every active Attempt before changing this Role.'
  if (task.status === 'needs_attention') {
    return 'Confirm every pending reconciliation before changing this Role.'
  }
  if (task.status !== 'ready' && task.status !== 'changes_requested') {
    return 'The Role can change only before the next Attempt starts.'
  }
  return undefined
}
