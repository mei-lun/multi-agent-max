import { Bot, CircleDot } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { MamExportExecutionActivityInput } from '../../../../shared/mam/execution-activity-export'
import type { UiLocale } from '../../i18n/ui-locale'
import { MamActivityTimeline, activityIcon } from './MamActivityTimeline'
import { MamLiveActivityDialog } from './MamLiveActivityDialog'
import { MamStateBadge } from './MamStateBadge'
import { isMamLiveNodeActive, type MamLiveNode } from './mam-live-activity-view-model'

export function MamLiveNodeCard({
  node,
  locale,
  workflowRunId,
  onExport
}: Readonly<{
  node: MamLiveNode
  locale: UiLocale
  workflowRunId: string
  onExport(input: MamExportExecutionActivityInput): Promise<string | undefined>
}>): React.JSX.Element {
  const latest = node.activities.at(-1)
  const activityViewport = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const viewport = activityViewport.current
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [node.activities.length])
  return (
    <article className="flex h-[26rem] flex-col overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-start gap-3 border-b border-border px-4 py-3">
        <span className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Bot className="size-4 text-muted-foreground" aria-hidden="true" />
          {isMamLiveNodeActive(node) && (
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-[var(--status-success)] ring-2 ring-card" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{node.task?.title ?? node.id}</h2>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {node.roleName ?? 'System node'} · {node.type ?? 'projected node'}
          </p>
        </div>
        <MamStateBadge status={node.status} />
      </header>
      <div className="border-b border-border bg-muted/30 px-4 py-2.5">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Current activity
        </p>
        <div className="mt-1 flex items-start gap-2 text-xs">
          {latest ? activityIcon(latest.category) : <CircleDot className="mt-0.5 size-3.5" />}
          <div className="min-w-0">
            <p className="font-medium">{latest?.title ?? statusSummary(node.status)}</p>
            {latest?.detail && <p className="mt-0.5 line-clamp-2 break-words">{latest.detail}</p>}
          </div>
        </div>
      </div>
      <div
        ref={activityViewport}
        aria-live="polite"
        className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        <MamActivityTimeline activities={node.activities.slice(-20)} locale={locale} />
      </div>
      <footer className="flex items-center justify-between border-t border-border px-3 py-2">
        <span className="text-[10px] text-muted-foreground">{node.activities.length} events</span>
        <MamLiveActivityDialog
          workflowRunId={workflowRunId}
          node={node}
          locale={locale}
          onExport={onExport}
        />
      </footer>
    </article>
  )
}

function statusSummary(status: MamLiveNode['status']): string {
  if (status === 'running') return 'Role is working'
  if (status === 'waiting_dependencies') return 'Waiting for dependencies'
  if (status === 'waiting_role_assignment') return 'Waiting for role assignment'
  if (status === 'waiting_for_approval') return 'Waiting for approval'
  if (status === 'passed' || status === 'approved') return 'Node completed'
  return 'No live event yet'
}
