import { MessageCircleQuestion } from 'lucide-react'
import { useState } from 'react'
import type { HumanAttentionItem } from '../../../../shared/mam/domain/human-attention'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import type {
  MamAnswerHumanQuestionsInput,
  MamConfirmHumanUnderstandingInput,
  MamReviseHumanUnderstandingInput,
  MamResolveHumanReviewInput
} from '../../../../shared/mam/application-command'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { MamHumanAttentionDialog } from './MamHumanAttentionDialog'
import { MamHumanReviewDialog } from './MamHumanReviewDialog'

type QueueEntry =
  | Readonly<{
      kind: 'conversation'
      id: string
      scope: HumanAttentionItem['scope']
      createdAt: string
      item: HumanAttentionItem
      run: MamUiSnapshot['runs'][number]
      blockedTaskCount: number
    }>
  | Readonly<{
      kind: 'review'
      id: string
      scope: 'branch'
      createdAt: string
      gate: MamUiSnapshot['runs'][number]['humanReviewGates'][number]
      run: MamUiSnapshot['runs'][number]
      blockedTaskCount: number
    }>

export function MamHumanAttentionPage({
  snapshot,
  pending,
  onAnswer,
  onConfirm,
  onRevise,
  onResolveReview
}: Readonly<{
  snapshot: MamUiSnapshot
  pending: boolean
  onAnswer(input: MamAnswerHumanQuestionsInput): Promise<void>
  onConfirm(input: MamConfirmHumanUnderstandingInput): Promise<void>
  onRevise(input: MamReviseHumanUnderstandingInput): Promise<void>
  onResolveReview(input: MamResolveHumanReviewInput): Promise<void>
}>): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string>()
  const entries = attentionQueue(snapshot)
  const selected = entries.find((entry) => entry.id === selectedId)
  return (
    <section className="mx-auto w-full max-w-5xl space-y-6 p-6" aria-labelledby="attention-title">
      <div>
        <h1 id="attention-title" className="text-xl font-semibold">
          Needs your attention
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Role questions, revision consultations, and human decisions in deterministic priority
          order.
        </p>
      </div>
      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nothing is waiting for you.
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <AttentionQueueCard key={entry.id} entry={entry} onOpen={setSelectedId} />
          ))}
        </div>
      )}
      <MamHumanAttentionDialog
        item={selected?.kind === 'conversation' ? selected.item : undefined}
        run={selected?.run}
        pending={pending}
        onOpenChange={(open) => {
          if (!open) setSelectedId(undefined)
        }}
        onAnswer={onAnswer}
        onRevise={onRevise}
        onConfirm={async (input) => {
          await onConfirm(input)
          setSelectedId(undefined)
        }}
      />
      <MamHumanReviewDialog
        gate={selected?.kind === 'review' ? selected.gate : undefined}
        run={selected?.run}
        pending={pending}
        onOpenChange={(open) => {
          if (!open) setSelectedId(undefined)
        }}
        onResolve={async (input) => {
          await onResolveReview(input)
          setSelectedId(undefined)
        }}
      />
    </section>
  )
}

function attentionQueue(snapshot: MamUiSnapshot): QueueEntry[] {
  return snapshot.runs
    .flatMap((run): QueueEntry[] => [
      ...run.humanAttentionItems
        .filter((item) => item.status !== 'resolved' && item.status !== 'blocked')
        .map((item) => ({
          kind: 'conversation' as const,
          id: item.id,
          scope: item.scope,
          createdAt: item.createdAt,
          item,
          run,
          blockedTaskCount: countBlockedTasks(run, item.taskId)
        })),
      ...run.humanReviewGates
        .filter((gate) => gate.status === 'pending')
        .map((gate) => ({
          kind: 'review' as const,
          id: `review:${run.run.id}:${gate.id}`,
          scope: 'branch' as const,
          createdAt: gate.createdAt,
          gate,
          run,
          blockedTaskCount: countBlockedTasks(run, gate.revisionTargetTaskId)
        }))
    ])
    .sort(
      (left, right) =>
        scopePriority(left.scope) - scopePriority(right.scope) ||
        right.blockedTaskCount - left.blockedTaskCount ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
    )
}

function AttentionQueueCard({
  entry,
  onOpen
}: Readonly<{ entry: QueueEntry; onOpen(id: string): void }>): React.JSX.Element {
  const task = entry.run.tasks.find((candidate) =>
    entry.kind === 'conversation'
      ? candidate.id === entry.item.taskId
      : candidate.id === entry.gate.revisionTargetTaskId
  )
  const title =
    entry.kind === 'conversation'
      ? entry.item.batches.at(-1)!.title
      : `Human review · ${task?.title ?? entry.gate.id}`
  const summary =
    entry.kind === 'conversation' ? entry.item.batches.at(-1)!.summary : entry.gate.instructions
  const role =
    entry.kind === 'conversation'
      ? entry.run.roleProfiles.find((candidate) => candidate.id === entry.item.roleProfileId)
      : undefined
  return (
    <article className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <MessageCircleQuestion className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">{title}</h2>
          <Badge variant="outline">{entry.scope}</Badge>
          {entry.kind === 'conversation' && (
            <Badge variant="outline">{entry.item.batches.at(-1)!.questions.length} questions</Badge>
          )}
        </div>
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{summary}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {entry.kind === 'conversation' && `${role?.displayName ?? entry.item.roleProfileId} · `}
          {entry.run.definitionName} · {task?.title}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Blocks {entry.blockedTaskCount} task{entry.blockedTaskCount === 1 ? '' : 's'} · waiting
          since {new Date(entry.createdAt).toLocaleString()}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={() => onOpen(entry.id)}>
        {entry.kind === 'conversation' ? 'Open conversation' : 'Open review'}
      </Button>
    </article>
  )
}

function countBlockedTasks(run: MamUiSnapshot['runs'][number], sourceTaskId: string): number {
  const blocked = new Set([sourceTaskId])
  let changed = true
  while (changed) {
    changed = false
    for (const task of run.tasks) {
      if (
        !blocked.has(task.id) &&
        task.dependencies.some((dependency) => blocked.has(dependency))
      ) {
        blocked.add(task.id)
        changed = true
      }
    }
  }
  return blocked.size
}

function scopePriority(scope: HumanAttentionItem['scope']): number {
  if (scope === 'run') return 0
  if (scope === 'branch') return 1
  return 2
}
