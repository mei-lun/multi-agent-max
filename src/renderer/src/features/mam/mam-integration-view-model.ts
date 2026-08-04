import type { MamUiRunSnapshot, MamUiSnapshot } from '../../../../shared/mam/ui-projection'

export type MamIntegrationItem = Readonly<{
  run: MamUiRunSnapshot
  entry: MamUiRunSnapshot['mergeQueueEntries'][number]
}>

export type MamIntegrationSection = 'attention' | 'integrating' | 'queued' | 'history'

export type MamIntegrationEmptyState = Readonly<{
  title: string
  detail: string
  action: 'workflows' | 'reviews' | 'runs'
  actionLabel: string
}>

export function mamIntegrationItems(
  runs: readonly MamUiRunSnapshot[],
  focusedRunId?: string
): readonly MamIntegrationItem[] {
  return runs
    .filter((run) => !focusedRunId || run.run.id === focusedRunId)
    .flatMap((run) => run.mergeQueueEntries.map((entry) => ({ run, entry })))
    .sort(compareIntegrationItems)
}

export function mamIntegrationSection(item: MamIntegrationItem): MamIntegrationSection {
  if (item.entry.status === 'failed' || item.entry.status === 'conflict') return 'attention'
  if (item.entry.status === 'merging') return 'integrating'
  if (item.entry.status === 'queued') return 'queued'
  return 'history'
}

export function mamIntegrationSectionCounts(
  items: readonly MamIntegrationItem[]
): Readonly<Record<MamIntegrationSection, number>> {
  const counts = { attention: 0, integrating: 0, queued: 0, history: 0 }
  for (const item of items) counts[mamIntegrationSection(item)] += 1
  return counts
}

export function mamIntegrationEmptyState(
  runs: readonly MamUiRunSnapshot[],
  workflows: MamUiSnapshot['workflows']
): MamIntegrationEmptyState {
  if (runs.length === 0) {
    return {
      title: 'No integration activity yet',
      detail: 'Start a Workflow Run with a Git merge stage to track reviewed revisions here.',
      action: 'workflows',
      actionLabel: 'Create Workflow'
    }
  }
  const definitions = runs.flatMap((run) =>
    workflows.filter(
      (definition) =>
        definition.id === run.run.definitionId && definition.version === run.run.definitionVersion
    )
  )
  if (
    definitions.length === runs.length &&
    definitions.every((definition) => !hasMergeNode(definition))
  ) {
    return {
      title: 'These Workflows have no integration stage',
      detail:
        'Create a delivery Workflow for future Runs. Completed Run history remains unchanged.',
      action: 'workflows',
      actionLabel: 'Create delivery Workflow'
    }
  }
  if (runs.some(hasPendingReview)) {
    return {
      title: 'Reviewed revisions are not ready yet',
      detail:
        'Complete the pending Review. Current validation evidence must also match the revision.',
      action: 'reviews',
      actionLabel: 'View Reviews'
    }
  }
  if (runs.some((run) => run.tasks.some((task) => task.status === 'approved'))) {
    return {
      title: 'Approved revisions are waiting on integration prerequisites',
      detail: 'Open the Run to inspect downstream dependencies and validation evidence.',
      action: 'runs',
      actionLabel: 'View Runs'
    }
  }
  return {
    title: 'No current integration activity',
    detail:
      'Entries appear when a reviewed revision reaches a Git merge stage with current evidence.',
    action: 'runs',
    actionLabel: 'View Runs'
  }
}

function hasMergeNode(definition: MamUiSnapshot['workflows'][number]): boolean {
  return definition.nodes.some((node) => node.type === 'git_merge')
}

function hasPendingReview(run: MamUiRunSnapshot): boolean {
  return run.tasks.some(
    (task) =>
      task.kind === 'review' &&
      !['approved', 'completed', 'cancelled', 'blocked'].includes(task.status)
  )
}

function compareIntegrationItems(left: MamIntegrationItem, right: MamIntegrationItem): number {
  return (
    left.entry.mergeReadyAt.localeCompare(right.entry.mergeReadyAt) ||
    left.entry.taskId.localeCompare(right.entry.taskId) ||
    left.entry.id.localeCompare(right.entry.id)
  )
}
