import { AlertTriangle, CheckCircle2, CircleHelp, Lightbulb } from 'lucide-react'
import type { MamDesignReview } from '../../../../shared/mam/design-proposal'

export function MamDesignConversationReview({
  review
}: Readonly<{ review: MamDesignReview }>): React.JSX.Element {
  const unresolved = review.findings.filter((finding) => finding.status === 'unresolved')
  const addressed = review.findings.filter((finding) => finding.status === 'addressed')
  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-3 text-xs">
      <ReviewHeading readiness={review.readiness} />
      {review.questions.length > 0 && (
        <div>
          <p className="mb-1 font-semibold">Questions to continue</p>
          <ol className="list-decimal space-y-1 pl-5">
            {review.questions.map((question, index) => (
              <li key={`${index}:${question}`} data-i18n-skip className="break-words">
                {question}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-muted-foreground">Reply in the conversation with your choices.</p>
        </div>
      )}
      {unresolved.length > 0 && (
        <ReviewFindings title="Open Workflow findings" findings={unresolved} />
      )}
      {addressed.length > 0 && (
        <ReviewFindings title="Improvements in this draft" findings={addressed} />
      )}
      {review.assumptions.length > 0 && (
        <div>
          <p className="mb-1 flex items-center gap-1 font-semibold">
            <Lightbulb className="size-3" /> Assumptions
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {review.assumptions.map((assumption, index) => (
              <li key={`${index}:${assumption}`} data-i18n-skip className="break-words">
                {assumption}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function ReviewHeading({ readiness }: Readonly<{ readiness: MamDesignReview['readiness'] }>) {
  if (readiness === 'needs_clarification') {
    return (
      <p className="flex items-center gap-1.5 font-semibold">
        <CircleHelp className="size-3.5" /> Your input is needed
      </p>
    )
  }
  if (readiness === 'needs_revision') {
    return (
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="size-3.5" /> The Workflow still needs revision
      </p>
    )
  }
  return (
    <p className="flex items-center gap-1.5 font-semibold">
      <CheckCircle2 className="size-3.5" /> The Workflow is ready for your review
    </p>
  )
}

function ReviewFindings({
  title,
  findings
}: Readonly<{ title: string; findings: MamDesignReview['findings'] }>): React.JSX.Element {
  return (
    <div>
      <p className="mb-1 font-semibold">{title}</p>
      <ul className="space-y-2">
        {findings.map((finding, index) => (
          <li key={`${index}:${finding.title}`} className="border-l-2 border-border pl-2">
            <p data-i18n-skip className="font-medium">
              {finding.title}
            </p>
            <p data-i18n-skip className="mt-0.5 break-words text-muted-foreground">
              {finding.detail}
            </p>
            <p data-i18n-skip className="mt-0.5 break-words">
              {finding.recommendation}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
