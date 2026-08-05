import { Download, Loader2, Maximize2 } from 'lucide-react'
import { useState } from 'react'
import type { MamExportExecutionActivityInput } from '../../../../shared/mam/execution-activity-export'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '../../components/ui/dialog'
import type { UiLocale } from '../../i18n/ui-locale'
import { MamActivityTimeline } from './MamActivityTimeline'
import type { MamLiveNode } from './mam-live-activity-view-model'

export function MamLiveActivityDialog({
  workflowRunId,
  node,
  locale,
  onExport
}: Readonly<{
  workflowRunId: string
  node: MamLiveNode
  locale: UiLocale
  onExport(input: MamExportExecutionActivityInput): Promise<string | undefined>
}>): React.JSX.Element {
  const [exporting, setExporting] = useState(false)
  const [exportedPath, setExportedPath] = useState<string>()
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="xs">
          <Maximize2 /> View full activity
        </Button>
      </DialogTrigger>
      <DialogContent className="grid h-[min(85dvh,48rem)] max-w-5xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle>{node.task?.title ?? node.id}</DialogTitle>
          <DialogDescription>
            Complete observed execution activity for {node.roleName ?? 'System node'}.
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-sleek min-h-0 overflow-y-auto px-5 py-4">
          <MamActivityTimeline activities={node.activities} locale={locale} />
        </div>
        <DialogFooter className="items-center border-t border-border px-5 py-3 sm:justify-between">
          <p className="min-w-0 truncate text-[11px] text-muted-foreground">
            {exportedPath ? `Exported to ${exportedPath}` : `${node.activities.length} events`}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={exporting}
            onClick={async () => {
              setExporting(true)
              try {
                const path = await onExport({ workflowRunId, nodeId: node.id })
                if (path) setExportedPath(path)
              } finally {
                setExporting(false)
              }
            }}
          >
            {exporting ? <Loader2 className="animate-spin" /> : <Download />}
            Export node activity
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
