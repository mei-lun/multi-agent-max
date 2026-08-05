import { Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { MamDeleteRoleProfileInput } from '../../../../shared/mam/application-command'
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

type Role = MamUiSnapshot['roles'][number]

export function MamDeleteRoleDialog({
  role,
  snapshot,
  pending,
  onDelete
}: Readonly<{
  role: Role
  snapshot: MamUiSnapshot
  pending: boolean
  onDelete(input: MamDeleteRoleProfileInput): Promise<void>
}>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()
  const { locale } = useUiLocale()
  const impact = roleRemovalImpact(snapshot, role.id)
  const copy = roleRemovalCopy(locale, role.displayName, impact)
  const changeOpen = (next: boolean): void => {
    if (next) setError(undefined)
    setOpen(next)
  }
  const remove = async (): Promise<void> => {
    setSubmitting(true)
    setError(undefined)
    try {
      await onDelete({ roleProfileId: role.id })
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="xs" disabled={pending}>
          <Trash2 /> Remove
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
          <p>{copy.history}</p>
          {impact.workflowReferences > 0 && <p className="text-destructive">{copy.workflows}</p>}
        </div>
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
            {submitting ? copy.removing : copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function roleRemovalImpact(
  snapshot: MamUiSnapshot,
  roleProfileId: string
): Readonly<{ historicalRuns: number; workflowReferences: number }> {
  const historicalRuns = snapshot.runs.filter((run) =>
    run.run.roleCatalog.some((entry) => entry.roleProfileId === roleProfileId)
  ).length
  const workflowReferences = snapshot.workflows.filter((workflow) =>
    workflow.nodes.some(
      (node) =>
        'allowedRoleProfileIds' in node &&
        [...node.allowedRoleProfileIds, ...node.recommendedRoleProfileIds].includes(roleProfileId)
    )
  ).length
  return { historicalRuns, workflowReferences }
}

function roleRemovalCopy(
  locale: UiLocale,
  displayName: string,
  impact: ReturnType<typeof roleRemovalImpact>
): Readonly<{
  title: string
  description: string
  history: string
  workflows: string
  confirm: string
  removing: string
}> {
  if (locale === 'zh-CN') {
    return {
      title: `从本机活动角色中移除“${displayName}”？`,
      description: '该角色将不再用于新运行和新的工作流节点绑定；已保存的不可变版本不会被销毁。',
      history: `${impact.historicalRuns} 条历史运行继续保留其冻结角色版本。`,
      workflows: `${impact.workflowReferences} 个活动工作流仍引用此角色；更新工作流或重新创建该角色后才能启动新运行。`,
      confirm: '移除角色',
      removing: '正在移除…'
    }
  }
  return {
    title: `Remove “${displayName}” from active local Roles?`,
    description:
      'The Role will disappear from new Runs and new Workflow node bindings. Stored immutable versions are not destroyed.',
    history: `${impact.historicalRuns} historical Runs keep their frozen Role version.`,
    workflows: `${impact.workflowReferences} active Workflows still reference this Role. Update them or recreate the Role before starting a new Run.`,
    confirm: 'Remove Role',
    removing: 'Removing…'
  }
}
