import { Check, CircleHelp, GitCompareArrows, ListChecks, Sparkles } from 'lucide-react'
import type {
  MamDesignBrainstormDecision,
  MamDesignBrainstormState
} from '../../../../shared/mam/design-brainstorm'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'

export function MamDesignBrainstormPanel({
  brainstorm,
  pending,
  onAnswer,
  onDecision
}: Readonly<{
  brainstorm: MamDesignBrainstormState
  pending: boolean
  onAnswer(message: string): Promise<void>
  onDecision(message: string, decision: MamDesignBrainstormDecision): Promise<void>
}>): React.JSX.Element {
  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-3 text-xs">
      <BrainstormHeading phase={brainstorm.phase} />
      {brainstorm.question && (
        <QuestionCard question={brainstorm.question} pending={pending} onAnswer={onAnswer} />
      )}
      {brainstorm.approaches.length > 0 && (
        <ApproachCards brainstorm={brainstorm} pending={pending} onDecision={onDecision} />
      )}
      {brainstorm.sections.length > 0 && (
        <DesignSections brainstorm={brainstorm} pending={pending} onDecision={onDecision} />
      )}
    </section>
  )
}

function BrainstormHeading({ phase }: Readonly<{ phase: MamDesignBrainstormState['phase'] }>) {
  const content = {
    clarifying: ['Clarifying the Design', CircleHelp],
    comparing_approaches: ['Compare approaches', GitCompareArrows],
    reviewing_design: ['Review the Design in sections', ListChecks],
    ready: ['Brainstorming complete', Check]
  } as const
  const [label, Icon] = content[phase]
  return (
    <p className="flex items-center gap-1.5 font-semibold">
      <Icon className="size-3.5" /> {label}
    </p>
  )
}

function QuestionCard({
  question,
  pending,
  onAnswer
}: Readonly<{
  question: NonNullable<MamDesignBrainstormState['question']>
  pending: boolean
  onAnswer(message: string): Promise<void>
}>): React.JSX.Element {
  return (
    <div className="space-y-2">
      <p data-i18n-skip className="text-sm font-medium">
        {question.prompt}
      </p>
      <p data-i18n-skip className="text-muted-foreground">
        {question.whyItMatters}
      </p>
      {question.options.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {question.options.map((option) => (
            <Button
              key={option.id}
              className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
              variant="outline"
              disabled={pending}
              onClick={() => void onAnswer(`${option.label}: ${option.description}`)}
            >
              <span data-i18n-skip>
                <span className="block font-medium">{option.label}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {option.description}
                </span>
              </span>
            </Button>
          ))}
        </div>
      )}
      <p className="text-muted-foreground">Choose an option or reply in your own words.</p>
    </div>
  )
}

function ApproachCards({
  brainstorm,
  pending,
  onDecision
}: Readonly<{
  brainstorm: MamDesignBrainstormState
  pending: boolean
  onDecision(message: string, decision: MamDesignBrainstormDecision): Promise<void>
}>): React.JSX.Element {
  return (
    <div className="space-y-2">
      {brainstorm.approaches.map((approach) => {
        const selected = approach.id === brainstorm.selectedApproachId
        return (
          <article key={approach.id} className="rounded-md border border-border bg-background p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p data-i18n-skip className="font-semibold">
                  {approach.title}
                </p>
                <p data-i18n-skip className="mt-1 text-muted-foreground">
                  {approach.summary}
                </p>
              </div>
              {approach.recommended && (
                <Badge variant="secondary">
                  <Sparkles /> Recommended
                </Badge>
              )}
              {selected && <Badge variant="outline">Selected</Badge>}
            </div>
            <ApproachPoints label="Benefits" points={approach.benefits} />
            <ApproachPoints label="Trade-offs" points={approach.tradeoffs} />
            {!selected && (
              <Button
                className="mt-3"
                size="xs"
                variant={approach.recommended ? 'default' : 'outline'}
                disabled={pending}
                onClick={() =>
                  void onDecision(`I choose the “${approach.title}” approach.`, {
                    type: 'select_approach',
                    approachId: approach.id
                  })
                }
              >
                {brainstorm.selectedApproachId ? 'Switch to this approach' : 'Choose this approach'}
              </Button>
            )}
          </article>
        )
      })}
    </div>
  )
}

function ApproachPoints({ label, points }: Readonly<{ label: string; points: readonly string[] }>) {
  if (points.length === 0) return null
  return (
    <div className="mt-2">
      <p className="font-medium">{label}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
        {points.map((point, index) => (
          <li key={`${index}:${point}`} data-i18n-skip>
            {point}
          </li>
        ))}
      </ul>
    </div>
  )
}

function DesignSections({
  brainstorm,
  pending,
  onDecision
}: Readonly<{
  brainstorm: MamDesignBrainstormState
  pending: boolean
  onDecision(message: string, decision: MamDesignBrainstormDecision): Promise<void>
}>): React.JSX.Element {
  return (
    <div className="space-y-2">
      {brainstorm.sections.map((section) => {
        const approved = brainstorm.approvedSectionIds.includes(section.id)
        return (
          <article key={section.id} className="rounded-md border border-border bg-background p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p data-i18n-skip className="font-semibold">
                  {section.title}
                </p>
                <p data-i18n-skip className="mt-1 whitespace-pre-wrap text-muted-foreground">
                  {section.summary}
                </p>
              </div>
              {approved && <Badge variant="outline">Approved</Badge>}
            </div>
            {!approved && (
              <Button
                className="mt-3"
                size="xs"
                disabled={pending}
                onClick={() =>
                  void onDecision(`I approve the “${section.title}” Design section.`, {
                    type: 'approve_section',
                    sectionId: section.id
                  })
                }
              >
                <Check /> Approve section
              </Button>
            )}
          </article>
        )
      })}
      <p className="text-muted-foreground">
        Reply with requested changes instead of approving a section that needs revision.
      </p>
    </div>
  )
}
