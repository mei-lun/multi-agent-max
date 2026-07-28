import { Plus, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { MamSubmitReviewInput } from '../../../../shared/mam/application-command'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
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
import { Input } from '../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { Textarea } from '../../components/ui/textarea'
import { MamWorkflowLabeledField } from './MamWorkflowFieldControls'

type FindingInput = MamSubmitReviewInput['findings'][number]

export function MamReviewSubmissionDialog({
  workflowRunId,
  task,
  attempt,
  pending,
  onSubmit
}: Readonly<{
  workflowRunId: string
  task: MamUiRunSnapshot['tasks'][number]
  attempt: MamUiRunSnapshot['attempts'][number]
  pending: boolean
  onSubmit(input: MamSubmitReviewInput): Promise<void>
}>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<MamSubmitReviewInput['status']>('approved')
  const [summary, setSummary] = useState('')
  const [findings, setFindings] = useState<FindingInput[]>([])
  const [error, setError] = useState<string>()
  const submit = async (): Promise<void> => {
    try {
      await onSubmit({
        workflowRunId,
        reviewerTaskId: task.id,
        reviewerAttemptId: attempt.id,
        status,
        summary,
        findings
      })
      setOpen(false)
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="xs">
          <Send /> Submit decision
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Submit structured Review</DialogTitle>
          <DialogDescription>
            The Main process binds this decision to the immutable subject and active reviewer
            Attempt. Renderer input cannot replace those authority fields.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">{task.title}</p>
            <p className="mt-1 font-mono">Reviewer Attempt {attempt.id}</p>
          </div>
          <MamWorkflowLabeledField label="Decision">
            <Select
              value={status}
              onValueChange={(value) => {
                const next = value as MamSubmitReviewInput['status']
                setStatus(next)
                if (next === 'changes_requested' && findings.length === 0) {
                  setFindings([newFinding()])
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="changes_requested">Changes requested</SelectItem>
                <SelectItem value="blocked">Blocked</SelectItem>
              </SelectContent>
            </Select>
          </MamWorkflowLabeledField>
          <MamWorkflowLabeledField label="Summary">
            <Textarea
              className="min-h-24"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </MamWorkflowLabeledField>
          <fieldset className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <legend className="text-xs font-medium">Findings</legend>
              <Button
                variant="outline"
                size="xs"
                onClick={() => setFindings([...findings, newFinding()])}
              >
                <Plus /> Add finding
              </Button>
            </div>
            {findings.map((finding, index) => (
              <FindingFields
                key={String(index)}
                finding={finding}
                onChange={(next) => setFindings(replaceAt(findings, index, next))}
                onRemove={() => setFindings(findings.filter((_, candidate) => candidate !== index))}
              />
            ))}
            {findings.length === 0 && (
              <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                No findings.
              </p>
            )}
          </fieldset>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={pending || !summary.trim()} onClick={() => void submit()}>
            Submit Review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FindingFields({
  finding,
  onChange,
  onRemove
}: Readonly<{
  finding: FindingInput
  onChange(finding: FindingInput): void
  onRemove(): void
}>): React.JSX.Element {
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex justify-end">
        <Button variant="ghost" size="icon-xs" aria-label="Remove finding" onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MamWorkflowLabeledField label="Severity">
          <Select
            value={finding.severity}
            onValueChange={(severity) =>
              onChange({ ...finding, severity: severity as FindingInput['severity'] })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['blocker', 'high', 'medium', 'low'].map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </MamWorkflowLabeledField>
        <MamWorkflowLabeledField label="Category">
          <Input
            value={finding.category}
            onChange={(event) => onChange({ ...finding, category: event.target.value })}
          />
        </MamWorkflowLabeledField>
      </div>
      <MamWorkflowLabeledField label="Finding summary">
        <Textarea
          value={finding.summary}
          onChange={(event) => onChange({ ...finding, summary: event.target.value })}
        />
      </MamWorkflowLabeledField>
      <div className="grid grid-cols-[1fr_7rem] gap-2">
        <MamWorkflowLabeledField label="File path (optional)">
          <Input
            className="font-mono"
            value={finding.filePath ?? ''}
            onChange={(event) => onChange(withOptionalPath(finding, event.target.value))}
          />
        </MamWorkflowLabeledField>
        <MamWorkflowLabeledField label="Line (optional)">
          <Input
            type="number"
            min={1}
            value={finding.line ?? ''}
            onChange={(event) => onChange(withOptionalLine(finding, event.target.valueAsNumber))}
          />
        </MamWorkflowLabeledField>
      </div>
    </div>
  )
}

function newFinding(): FindingInput {
  return { severity: 'medium', category: 'quality', summary: '' }
}
function replaceAt<T>(values: readonly T[], index: number, value: T): T[] {
  return values.map((candidate, candidateIndex) => (candidateIndex === index ? value : candidate))
}
function withOptionalPath(finding: FindingInput, value: string): FindingInput {
  const { filePath: _, ...base } = finding
  return value ? { ...base, filePath: value } : base
}
function withOptionalLine(finding: FindingInput, value: number): FindingInput {
  const { line: _, ...base } = finding
  return Number.isNaN(value) ? base : { ...base, line: value }
}
