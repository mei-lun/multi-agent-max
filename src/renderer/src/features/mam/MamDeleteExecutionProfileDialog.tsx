import { Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { MamDeleteExecutionProfileInput } from '../../../../shared/mam/application-command'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { executionProfileReferences } from '../../../../shared/mam/execution-profile-removal'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip'
import { useUiLocale } from '../../i18n/ui-locale'

export function MamDeleteExecutionProfileDialog({
  input,
  name,
  snapshot,
  pending,
  onDelete
}: Readonly<{
  input: MamDeleteExecutionProfileInput
  name: string
  snapshot: MamUiSnapshot
  pending: boolean
  onDelete(input: MamDeleteExecutionProfileInput): Promise<void>
}>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()
  const chinese = useUiLocale().locale === 'zh-CN'
  const references = executionProfileReferences(snapshot, input)
  const label = chinese ? '删除配置' : 'Delete profile'
  const remove = async (): Promise<void> => {
    setSubmitting(true)
    setError(undefined)
    try {
      await onDelete(input)
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!submitting) {
          setOpen(value)
          setError(undefined)
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-destructive"
              aria-label={`${label}: ${name}`}
              disabled={pending}
            >
              <Trash2 />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{chinese ? `删除“${name}”？` : `Delete "${name}"?`}</DialogTitle>
          <DialogDescription>
            {chinese
              ? '从当前配置列表移除。保留历史版本、本机密钥及绑定，供已有运行使用。'
              : 'Remove from current profiles. Historical versions, local credentials and bindings remain available for existing Runs.'}
          </DialogDescription>
        </DialogHeader>
        {references.length > 0 && (
          <p role="alert" className="break-words text-sm text-destructive">
            {chinese ? '请先解除以下引用：' : 'Remove these references first: '}
            {references.join(', ')}
          </p>
        )}
        {error && (
          <p role="alert" className="break-words text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={submitting} onClick={() => setOpen(false)}>
            {chinese ? '取消' : 'Cancel'}
          </Button>
          <Button
            variant="destructive"
            disabled={pending || submitting || references.length > 0}
            onClick={() => void remove()}
          >
            {submitting ? <Loader2 className="animate-spin" /> : <Trash2 />}
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
