import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'

export type MamLiveNode = Readonly<{
  id: string
  type?: WorkflowDefinition['nodes'][number]['type']
  status: MamUiRunSnapshot['nodeRuns'][number]['status']
  task?: MamUiRunSnapshot['tasks'][number]
  attempt?: MamUiRunSnapshot['attempts'][number]
  roleName?: string
  activities: MamUiRunSnapshot['activities']
}>

export type MamLiveNodeFilter = 'all' | 'active' | 'attention'

const ACTIVE_STATUSES = new Set(['running', 'validating_output', 'submitted', 'in_review'])
const ATTENTION_STATUSES = new Set(['failed', 'blocked', 'changes_requested'])

export function mamLiveNodes(
  run: MamUiRunSnapshot,
  definition: WorkflowDefinition | undefined
): MamLiveNode[] {
  const projected = new Map(run.nodeRuns.map((node) => [node.nodeId, node]))
  const ids = [
    ...(definition?.nodes.map((node) => node.id) ?? []),
    ...run.nodeRuns.map((node) => node.nodeId)
  ].filter((id, index, values) => values.indexOf(id) === index)
  return ids.map((id) => {
    const node = projected.get(id)
    const activities = run.activities.filter((activity) => activity.nodeId === id)
    const latestActivity = activities.at(-1)
    const attempt = latestActivity?.attemptId
      ? run.attempts.find((candidate) => candidate.id === latestActivity.attemptId)
      : node?.latestAttemptId
        ? run.attempts.find((candidate) => candidate.id === node.latestAttemptId)
        : undefined
    const task = attempt
      ? run.tasks.find((candidate) => candidate.id === attempt.taskId)
      : undefined
    const role = task?.roleProfileId
      ? run.roleProfiles.find(
          (candidate) =>
            candidate.id === task.roleProfileId && candidate.version === task.roleProfileVersion
        )
      : undefined
    return {
      id,
      ...(definition?.nodes.find((candidate) => candidate.id === id)?.type
        ? { type: definition.nodes.find((candidate) => candidate.id === id)!.type }
        : {}),
      status: node?.status ?? 'created',
      ...(task ? { task } : {}),
      ...(attempt ? { attempt } : {}),
      ...(role ? { roleName: role.displayName } : {}),
      activities
    }
  })
}

export function filterMamLiveNodes(
  nodes: readonly MamLiveNode[],
  filter: MamLiveNodeFilter
): MamLiveNode[] {
  if (filter === 'active') return nodes.filter((node) => ACTIVE_STATUSES.has(node.status))
  if (filter === 'attention') return nodes.filter((node) => ATTENTION_STATUSES.has(node.status))
  return [...nodes]
}

export function isMamLiveNodeActive(node: MamLiveNode): boolean {
  return ACTIVE_STATUSES.has(node.status)
}
