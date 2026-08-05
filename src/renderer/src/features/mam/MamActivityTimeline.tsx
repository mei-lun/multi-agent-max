import {
  Activity,
  CheckCircle2,
  MessageSquareText,
  TerminalSquare,
  TriangleAlert,
  Wrench
} from 'lucide-react'
import type { MamUiExecutionActivity } from '../../../../shared/mam/ui-projection'
import type { UiLocale } from '../../i18n/ui-locale'
import { cn } from '../../lib/class-name'

export function MamActivityTimeline({
  activities,
  locale,
  className
}: Readonly<{
  activities: readonly MamUiExecutionActivity[]
  locale: UiLocale
  className?: string
}>): React.JSX.Element {
  if (activities.length === 0) {
    return (
      <p className={cn('py-6 text-center text-xs text-muted-foreground', className)}>
        No execution activity recorded yet.
      </p>
    )
  }
  return (
    <ol className={cn('space-y-3', className)}>
      {activities.map((activity) => (
        <li key={activity.id} className="flex gap-2.5 text-xs">
          <span className="mt-0.5 text-muted-foreground">{activityIcon(activity.category)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{activity.title}</span>
              <time className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {formatActivityTime(activity.at, locale)}
              </time>
            </div>
            {activity.detail && (
              <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                {activity.detail}
              </pre>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function activityIcon(category: MamUiExecutionActivity['category']): React.JSX.Element {
  if (category === 'message') return <MessageSquareText className="size-3.5" aria-hidden="true" />
  if (category === 'command') return <TerminalSquare className="size-3.5" aria-hidden="true" />
  if (category === 'tool') return <Wrench className="size-3.5" aria-hidden="true" />
  if (category === 'error') {
    return <TriangleAlert className="size-3.5 text-destructive" aria-hidden="true" />
  }
  if (category === 'usage') return <Activity className="size-3.5" aria-hidden="true" />
  return <CheckCircle2 className="size-3.5" aria-hidden="true" />
}

function formatActivityTime(value: string, locale: UiLocale): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(value))
}
