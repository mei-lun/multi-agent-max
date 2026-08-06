import { useMemo, useState } from 'react'
import type { HumanAnswer, HumanAttentionItem } from '../../../../shared/mam/domain/human-attention'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import type {
  MamAnswerHumanQuestionsInput,
  MamConfirmHumanUnderstandingInput,
  MamReviseHumanUnderstandingInput
} from '../../../../shared/mam/application-command'
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

type DraftAnswer = Readonly<{ selectedOptionId?: string; customAnswer?: string }>

export function MamHumanAttentionDialog({
  item,
  run,
  pending,
  onOpenChange,
  onAnswer,
  onConfirm,
  onRevise
}: Readonly<{
  item?: HumanAttentionItem | undefined
  run?: MamUiRunSnapshot | undefined
  pending: boolean
  onOpenChange(open: boolean): void
  onAnswer(input: MamAnswerHumanQuestionsInput): Promise<void>
  onConfirm(input: MamConfirmHumanUnderstandingInput): Promise<void>
  onRevise(input: MamReviseHumanUnderstandingInput): Promise<void>
}>): React.JSX.Element {
  if (!item || !run) return <Dialog open={false} onOpenChange={onOpenChange} />
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item.batches.at(-1)?.title ?? 'Role question'}</DialogTitle>
          <DialogDescription>
            {run.definitionName} / {run.tasks.find((task) => task.id === item.taskId)?.title}
          </DialogDescription>
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant="outline">{item.scope} scope</Badge>
            <Badge variant="outline">{item.status.replaceAll('_', ' ')}</Badge>
          </div>
        </DialogHeader>
        <ConversationHistory item={item} />
        <AttentionAction
          key={`${item.id}:${item.updatedAt}`}
          item={item}
          pending={pending}
          onAnswer={(answers) =>
            onAnswer({
              workflowRunId: item.workflowRunId,
              taskId: item.taskId,
              interactionId: item.id,
              batchId: item.batches.at(-1)!.id,
              answers
            })
          }
          onConfirm={() =>
            onConfirm({
              workflowRunId: item.workflowRunId,
              taskId: item.taskId,
              interactionId: item.id
            })
          }
          onRevise={(feedback) =>
            onRevise({
              workflowRunId: item.workflowRunId,
              taskId: item.taskId,
              interactionId: item.id,
              feedback
            })
          }
        />
      </DialogContent>
    </Dialog>
  )
}

function ConversationHistory({ item }: Readonly<{ item: HumanAttentionItem }>): React.JSX.Element {
  return (
    <div className="space-y-4">
      {item.batches.map((batch, index) => {
        const answerBatch = item.answerBatches.find((candidate) => candidate.batchId === batch.id)
        return (
          <section key={batch.id} className="space-y-3 rounded-lg border border-border p-4">
            <div>
              <p className="text-sm font-medium">Role · Question batch {index + 1}</p>
              <p className="mt-1 text-xs text-muted-foreground">{batch.summary}</p>
            </div>
            {answerBatch && (
              <div className="rounded-md bg-muted/40 p-3 text-xs">
                <p className="font-medium">Your submitted answers</p>
                {answerBatch.answers.map((answer) => (
                  <p key={answer.questionId} className="mt-1 text-muted-foreground">
                    {answer.questionId}: {answer.customAnswer ?? answer.selectedOptionId}
                  </p>
                ))}
              </div>
            )}
          </section>
        )
      })}
      {item.understandingSummaries.map((summary, index) => {
        const revision = item.understandingRevisions[index]
        return (
          <div key={`${summary.submittedAt}:${String(index)}`} className="space-y-3">
            <section className="rounded-lg border border-border bg-muted/20 p-4">
              <p className="text-sm font-medium">Role · Final understanding</p>
              <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                {summary.summary}
              </p>
            </section>
            {revision && (
              <section className="rounded-lg border border-border p-4">
                <p className="text-sm font-medium">You · Clarification requested</p>
                <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                  {revision.feedback}
                </p>
              </section>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AttentionAction({
  item,
  pending,
  onAnswer,
  onConfirm,
  onRevise
}: Readonly<{
  item: HumanAttentionItem
  pending: boolean
  onAnswer(answers: HumanAnswer[]): Promise<void>
  onConfirm(): Promise<void>
  onRevise(feedback: string): Promise<void>
}>): React.JSX.Element {
  const batch = item.batches.at(-1)!
  const [drafts, setDrafts] = useState<Record<string, DraftAnswer>>({})
  const [revisionFeedback, setRevisionFeedback] = useState('')
  const answers = useMemo(
    () => materializeAnswers(batch.questions, drafts),
    [batch.questions, drafts]
  )
  if (item.status === 'ready_for_confirmation') {
    return (
      <div className="space-y-3">
        <Textarea
          placeholder="Explain what is still unclear or incorrect…"
          value={revisionFeedback}
          onChange={(event) => setRevisionFeedback(event.target.value)}
        />
        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending || !revisionFeedback.trim()}
            onClick={() => void onRevise(revisionFeedback.trim())}
          >
            Ask role to clarify
          </Button>
          <Button disabled={pending} onClick={() => void onConfirm()}>
            Confirm understanding and continue
          </Button>
        </DialogFooter>
      </div>
    )
  }
  if (item.status !== 'awaiting_human_answers') {
    return <p className="text-xs text-muted-foreground">The role is reviewing your answers…</p>
  }
  const useRecommendations = (): void => {
    setDrafts(
      Object.fromEntries(
        batch.questions.flatMap((question) =>
          question.recommendedOptionId
            ? [[question.id, { selectedOptionId: question.recommendedOptionId }]]
            : []
        )
      )
    )
  }
  return (
    <div className="space-y-4">
      {batch.questions.map((question, index) => (
        <QuestionEditor
          key={question.id}
          number={index + 1}
          question={question}
          draft={drafts[question.id]}
          onChange={(draft) => setDrafts((current) => ({ ...current, [question.id]: draft }))}
        />
      ))}
      <DialogFooter>
        {batch.questions.some((question) => question.recommendedOptionId) && (
          <Button variant="outline" disabled={pending} onClick={useRecommendations}>
            Use all recommendations
          </Button>
        )}
        <Button
          disabled={pending || answers.length !== batch.questions.length}
          onClick={() => void onAnswer(answers)}
        >
          Submit answers
        </Button>
      </DialogFooter>
    </div>
  )
}

function QuestionEditor({
  number,
  question,
  draft,
  onChange
}: Readonly<{
  number: number
  question: HumanAttentionItem['batches'][number]['questions'][number]
  draft?: DraftAnswer | undefined
  onChange(draft: DraftAnswer): void
}>): React.JSX.Element {
  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-medium">
        {number}. {question.question}
      </legend>
      <p className="text-xs text-muted-foreground">{question.whyItMatters}</p>
      {question.options.map((option) => (
        <label
          key={option.id}
          className="flex cursor-pointer gap-3 rounded-md border border-border p-3"
        >
          <input
            type="radio"
            name={question.id}
            checked={draft?.selectedOptionId === option.id}
            onChange={() => onChange({ selectedOptionId: option.id })}
          />
          <span className="min-w-0 text-xs">
            <span className="font-medium">{option.label}</span>
            {question.recommendedOptionId === option.id && (
              <Badge className="ml-2">Recommended</Badge>
            )}
            <span className="mt-1 block text-muted-foreground">{option.description}</span>
            {option.tradeoffs && (
              <span className="mt-1 block text-muted-foreground">
                Trade-offs: {option.tradeoffs}
              </span>
            )}
          </span>
        </label>
      ))}
      <Textarea
        placeholder={
          question.kind === 'information'
            ? 'Enter the required information…'
            : 'Or provide a custom answer…'
        }
        value={draft?.customAnswer ?? ''}
        onChange={(event) => onChange({ customAnswer: event.target.value })}
      />
      {question.recommendationReason && (
        <p className="text-xs text-muted-foreground">
          Recommendation: {question.recommendationReason}
        </p>
      )}
    </fieldset>
  )
}

function materializeAnswers(
  questions: HumanAttentionItem['batches'][number]['questions'],
  drafts: Record<string, DraftAnswer>
): HumanAnswer[] {
  const answers: HumanAnswer[] = []
  for (const question of questions) {
    const draft = drafts[question.id]
    if (draft?.customAnswer?.trim()) {
      answers.push({ questionId: question.id, customAnswer: draft.customAnswer.trim() })
    } else if (draft?.selectedOptionId) {
      answers.push({ questionId: question.id, selectedOptionId: draft.selectedOptionId })
    }
  }
  return answers
}
