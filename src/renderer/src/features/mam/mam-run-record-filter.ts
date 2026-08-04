import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'

export type MamRunRecordView = 'current' | 'attention' | 'completed' | 'cancelled' | 'all'

export const MAM_RUN_RECORD_VIEWS: readonly MamRunRecordView[] = [
  'current',
  'attention',
  'completed',
  'cancelled',
  'all'
]

export function filterMamRunRecords(
  runs: readonly MamUiRunSnapshot[],
  view: MamRunRecordView,
  query: string
): MamUiRunSnapshot[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return [...runs]
    .filter((run) => view === 'all' || mamRunRecordView(run) === view)
    .filter((run) => {
      if (!normalizedQuery) return true
      return [run.definitionName, run.run.id, run.run.definitionId].some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery)
      )
    })
    .sort((left, right) => right.run.updatedAt.localeCompare(left.run.updatedAt))
}

export function countMamRunRecords(
  runs: readonly MamUiRunSnapshot[]
): Readonly<Record<MamRunRecordView, number>> {
  const counts: Record<MamRunRecordView, number> = {
    current: 0,
    attention: 0,
    completed: 0,
    cancelled: 0,
    all: runs.length
  }
  for (const run of runs) counts[mamRunRecordView(run)] += 1
  return counts
}

export function preferredMamRunRecordView(runs: readonly MamUiRunSnapshot[]): MamRunRecordView {
  const counts = countMamRunRecords(runs)
  if (counts.attention > 0) return 'attention'
  if (counts.current > 0) return 'current'
  if (counts.completed > 0) return 'completed'
  if (counts.cancelled > 0) return 'cancelled'
  return 'all'
}

export function mamRunRecordView(run: MamUiRunSnapshot): Exclude<MamRunRecordView, 'all'> {
  if (run.run.status === 'completed') return 'completed'
  if (run.run.status === 'cancelled') return 'cancelled'
  if (
    run.run.status === 'blocked' ||
    run.run.status === 'awaiting_human_decision' ||
    run.tasks.some((task) =>
      ['blocked', 'changes_requested', 'needs_attention'].includes(task.status)
    )
  ) {
    return 'attention'
  }
  return 'current'
}

export function mamRunRecordViewLabel(view: MamRunRecordView): string {
  if (view === 'current') return 'Current'
  if (view === 'attention') return 'Needs attention'
  if (view === 'completed') return 'Completed'
  if (view === 'cancelled') return 'Cancelled'
  return 'All'
}
