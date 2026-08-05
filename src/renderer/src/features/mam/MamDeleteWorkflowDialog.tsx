import { Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { MamDeleteWorkflowInput } from '../../../../shared/mam/application-command'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
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
import { useUiLocale, type UiLocale } from '../../i18n/ui-locale'

export function MamDeleteWorkflowDialog({
  workflow,
  snapshot,
  pending,
  onDelete
}: Readonly<{
  workflow: WorkflowDefinition
  snapshot: MamUiSnapshot
  pending: boolean
  onDelete(input: MamDeleteWorkflowInput): Promise<void>
}>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()
  const { locale } = useUiLocale()
  const runCount = workflowRemovalRunCount(snapshot, workflow.id)
  const copy = workflowRemovalCopy(locale, workflow.name, runCount)
  const remove = async (): Promise<void> => {
    setSubmitting(true)
    setError(undefined)
    try {
      await onDelete({ definitionId: workflow.id })
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="xs" disabled={pending}>
          <Trash2 /> Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs">{copy.history}</p>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={submitting} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending || submitting}
            onClick={() => void remove()}
          >
            {submitting && <Loader2 className="animate-spin" />}
            {submitting ? copy.deleting : copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function workflowRemovalRunCount(snapshot: MamUiSnapshot, definitionId: string): number {
  return snapshot.runs.filter((run) => run.run.definitionId === definitionId).length
}

function workflowRemovalCopy(
  locale: UiLocale,
  name: string,
  runCount: number
): Readonly<{
  title: string
  description: string
  history: string
  confirm: string
  deleting: string
}> {
  if (locale === 'zh-CN') {
    return {
      title: `删除工作流“${name}”？`,
      description: '该工作流将从活动列表移除，不能再创建新的运行。',
      history: `${runCount} 条历史运行及其冻结的工作流和角色版本会继续保留。`,
      confirm: '删除工作流',
      deleting: '正在删除…'
    }
  }
  return {
    title: `Delete Workflow “${name}”?`,
    description: 'The Workflow will leave the active list and cannot start new Runs.',
    history: `${runCount} historical Runs keep their frozen Workflow and Role versions.`,
    confirm: 'Delete Workflow',
    deleting: 'Deleting…'
  }
}
