import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'

export type LocalRetryAttention = Readonly<{
  item: MamUiSnapshot['localRetryItems'][number]
  run: MamUiSnapshot['runs'][number]
  taskTitle: string
  blockedTaskCount: number
}>

export function localRetryAttention(snapshot: MamUiSnapshot): LocalRetryAttention[] {
  return (snapshot.localRetryItems ?? [])
    .flatMap((item) => {
      const run = snapshot.runs.find((candidate) => candidate.run.id === item.workflowRunId)
      if (!run) return []
      const blocked = new Set([item.taskId])
      let changed = true
      while (changed) {
        changed = false
        for (const task of run.tasks) {
          if (!blocked.has(task.id) && task.dependencies.some((id) => blocked.has(id))) {
            blocked.add(task.id)
            changed = true
          }
        }
      }
      return [
        {
          item,
          run,
          taskTitle: run.tasks.find((task) => task.id === item.taskId)?.title ?? item.taskId,
          blockedTaskCount: blocked.size
        }
      ]
    })
    .sort(
      (left, right) =>
        right.blockedTaskCount - left.blockedTaskCount ||
        left.item.occurredAt.localeCompare(right.item.occurredAt) ||
        left.item.draftId.localeCompare(right.item.draftId)
    )
}
