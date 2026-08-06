import { useState } from 'react'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import type { MamResolveHumanReviewInput } from '../../../../shared/mam/application-command'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../components/ui/dialog'
import { Textarea } from '../../components/ui/textarea'

export function MamHumanReviewDialog({
  gate,
  run,
  pending,
  onOpenChange,
  onResolve
}: Readonly<{
  gate?: MamUiRunSnapshot['humanReviewGates'][number] | undefined
  run?: MamUiRunSnapshot | undefined
  pending: boolean
  onOpenChange(open: boolean): void
  onResolve(input: MamResolveHumanReviewInput): Promise<void>
}>): React.JSX.Element {
  const [feedback, setFeedback] = useState('')
  if (!gate || !run) return <Dialog open={false} onOpenChange={onOpenChange} />
  const task = run.tasks.find((candidate) => candidate.id === gate.revisionTargetTaskId)
  const resolve = (status: MamResolveHumanReviewInput['status']): void => {
    void onResolve({
      workflowRunId: run.run.id,
      taskId: gate.revisionTargetTaskId,
      gateNodeId: gate.id,
      subject: gate.subject,
      status,
      ...(feedback.trim() ? { feedback: feedback.trim() } : {})
    })
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Human review · {task?.title ?? gate.revisionTargetTaskId}</DialogTitle>
          <DialogDescription>
            {run.definitionName} · Attempt {gate.subject.attemptId}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <section className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Immutable review subject</Badge>
              {gate.subject.submittedCommit && (
                <Badge variant="outline">{gate.subject.submittedCommit}</Badge>
              )}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{gate.instructions}</p>
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {gate.subject.artifactHashes.length} Artifact hashes · result{' '}
              {gate.subject.resultHash}
            </p>
          </section>
          <div>
            <label htmlFor="human-review-feedback" className="text-sm font-medium">
              Review feedback
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              Required when requesting changes or blocking. List all problem points in this text.
            </p>
            <Textarea
              id="human-review-feedback"
              className="mt-2 min-h-40"
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending || !feedback.trim()}
            onClick={() => resolve('blocked')}
          >
            Block
          </Button>
          <Button
            variant="outline"
            disabled={pending || !feedback.trim()}
            onClick={() => resolve('changes_requested')}
          >
            Request changes
          </Button>
          <Button disabled={pending} onClick={() => resolve('approved')}>
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
