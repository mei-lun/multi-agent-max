import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react'
import type { MamDesignDraft } from '../../../../shared/mam/design-assistant'
import { Button } from '../../components/ui/button'

export function MamDesignRecoveryCard({
  recovery,
  pending,
  onRetry,
  onTemplate
}: Readonly<{
  recovery: NonNullable<MamDesignDraft['recovery']>
  pending: boolean
  onRetry(): Promise<void>
  onTemplate(): Promise<void>
}>): React.JSX.Element {
  return (
    <section
      className="rounded-md border border-destructive/60 bg-destructive/5 p-3"
      aria-label="Generation recovery"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-destructive">Generation needs recovery</p>
          <p data-i18n-skip className="mt-1 break-words text-xs text-muted-foreground">
            {recovery.message}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="xs" disabled={pending} onClick={() => void onRetry()}>
          <RefreshCw /> Retry generation
        </Button>
        <Button variant="outline" size="xs" disabled={pending} onClick={() => void onTemplate()}>
          <Sparkles /> Load standard template
        </Button>
      </div>
    </section>
  )
}
