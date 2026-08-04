import { UserRoundPlus } from 'lucide-react'
import { useState } from 'react'
import type { MamAssignTaskInput } from '../../../../shared/mam/application-command'
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
import { taskRoleCandidates } from './mam-task-role-candidates'

export function MamAssignTaskDialog({
  run,
  task,
  pending,
  onAssign
}: Readonly<{
  run: MamUiRunSnapshot
  task: MamUiRunSnapshot['tasks'][number]
  pending: boolean
  onAssign(input: MamAssignTaskInput): Promise<void>
}>): React.JSX.Element {
  const candidates = taskRoleCandidates(run, task)
  const [open, setOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState(candidateKey(candidates[0]))
  const [error, setError] = useState<string>()
  const selected = candidates.find((candidate) => candidateKey(candidate) === selectedKey)
  if (candidates.length === 0) {
    return <p className="text-xs text-destructive">No allowed Role is available in this Run.</p>
  }
  const assign = async (): Promise<void> => {
    if (!selected) return
    setError(undefined)
    try {
      await onAssign({
        workflowRunId: run.run.id,
        taskId: task.id,
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
          setSelectedKey(candidateKey(candidates[0]))
          setError(undefined)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" disabled={pending}>
          <UserRoundPlus /> Assign Role
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign this Task</DialogTitle>
          <DialogDescription>
            Choose an allowed Role frozen into this Run. After assignment, start the Task here.
          </DialogDescription>
        </DialogHeader>
        <label className="block space-y-1 text-xs">
          <span className="font-medium">Role</span>
          <Select value={selectedKey} onValueChange={setSelectedKey}>
            <SelectTrigger className="w-full" aria-label="Role for this Task">
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
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button disabled={pending || !selected} onClick={() => void assign()}>
            Assign Role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function candidateKey(
  candidate: ReturnType<typeof taskRoleCandidates>[number] | undefined
): string {
  return candidate ? `${candidate.roleProfileId}:${candidate.roleProfileVersion}` : ''
}
