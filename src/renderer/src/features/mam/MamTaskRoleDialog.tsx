import { useState } from 'react'
import type { MamReassignTaskInput } from '../../../../shared/mam/application-command'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '../../components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import {
  frozenRoleName,
  taskRoleCandidates,
  taskRoleChangeBlockReason,
  type MamTaskRoleCandidate
} from './mam-task-role-candidates'

export function MamTaskRoleDialog({
  run,
  task,
  pending,
  onReassignTask
}: Readonly<{
  run: MamUiRunSnapshot
  task: MamUiRunSnapshot['tasks'][number]
  pending: boolean
  onReassignTask(input: MamReassignTaskInput): Promise<void>
}>): React.JSX.Element {
  const candidates = taskRoleCandidates(run, task)
  const blocked = taskRoleChangeBlockReason(run, task)
  if (!task.roleProfileId || !task.roleProfileVersion) return <></>
  if (!['ready', 'changes_requested', 'running', 'needs_attention'].includes(task.status)) {
    return <></>
  }
  if (blocked) return <p className="text-xs text-muted-foreground">{blocked}</p>
  if (candidates.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No other allowed Role version is available in this Run. Start a new Workflow Run to use
        newer Role versions.
      </p>
    )
  }
  return (
    <TaskRoleDialogContent
      run={run}
      task={task}
      currentRoleProfileId={task.roleProfileId}
      currentRoleProfileVersion={task.roleProfileVersion}
      candidates={candidates}
      pending={pending}
      onReassignTask={onReassignTask}
    />
  )
}

function TaskRoleDialogContent({
  run,
  task,
  currentRoleProfileId,
  currentRoleProfileVersion,
  candidates,
  pending,
  onReassignTask
}: Readonly<{
  run: MamUiRunSnapshot
  task: MamUiRunSnapshot['tasks'][number]
  currentRoleProfileId: string
  currentRoleProfileVersion: number
  candidates: readonly MamTaskRoleCandidate[]
  pending: boolean
  onReassignTask(input: MamReassignTaskInput): Promise<void>
}>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState(candidateKey(candidates[0]!))
  const [error, setError] = useState<string>()
  const selected = candidates.find((candidate) => candidateKey(candidate) === selectedKey)
  const submit = async (): Promise<void> => {
    if (!selected) return
    setError(undefined)
    try {
      await onReassignTask({
        workflowRunId: run.run.id,
        taskId: task.id,
        previousRoleProfileId: currentRoleProfileId,
        previousRoleProfileVersion: currentRoleProfileVersion,
        roleProfileId: selected.roleProfileId,
        roleProfileVersion: selected.roleProfileVersion
      })
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          setSelectedKey(candidateKey(candidates[0]!))
          setError(undefined)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="xs">
          Change Role
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change Task Role</DialogTitle>
          <DialogDescription>
            This affects future Attempts only. Existing Attempt history and Effective Config
            snapshots remain unchanged.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-xs">
          <p className="text-muted-foreground">
            Current: {frozenRoleName(run, currentRoleProfileId, currentRoleProfileVersion)} · v
            {currentRoleProfileVersion}
          </p>
          <label className="block space-y-1">
            <span className="font-medium">Role from this Run</span>
            <Select value={selectedKey} onValueChange={setSelectedKey}>
              <SelectTrigger className="w-full" aria-label="Role from this Run">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((candidate) => (
                  <SelectItem key={candidateKey(candidate)} value={candidateKey(candidate)}>
                    {candidate.displayName} · v{candidate.roleProfileVersion}
                    {candidate.recommended ? ' · Recommended' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button size="sm" disabled={pending || !selected} onClick={() => void submit()}>
            Change Role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function candidateKey(candidate: MamTaskRoleCandidate): string {
  return `${candidate.roleProfileId}:${candidate.roleProfileVersion}`
}
