import { randomUUID } from 'node:crypto'
import type {
  MamDesignBrainstormDecision,
  MamDesignBrainstormPresentation,
  MamDesignBrainstormState
} from '../../../shared/mam/design-brainstorm'
import type { MamDesignMessage } from '../../../shared/mam/design-assistant'
import type { MamDesignReview } from '../../../shared/mam/design-proposal'
import { failMamDesignAssistant } from './mam-design-assistant-error'

export function createMamDesignMessage(
  role: MamDesignMessage['role'],
  content: string,
  createdAt: string
): MamDesignMessage {
  return {
    id: `design-message.${randomUUID().replaceAll('-', '')}`,
    role,
    content,
    createdAt
  }
}

export function appendMamDesignMessages(
  messages: readonly MamDesignMessage[],
  ...next: readonly MamDesignMessage[]
): MamDesignMessage[] {
  return [...messages, ...next].slice(-200)
}

export function normalizeMamDesignReview(review: MamDesignReview): MamDesignReview {
  if (review.questions.length > 0) return { ...review, readiness: 'needs_clarification' }
  if (review.findings.some((finding) => finding.status === 'unresolved')) {
    return { ...review, readiness: 'needs_revision' }
  }
  return { ...review, readiness: review.readiness === 'ready' ? 'ready' : 'needs_revision' }
}

export function applyMamDesignBrainstormDecision(
  state: MamDesignBrainstormState | undefined,
  decision: MamDesignBrainstormDecision | undefined
): MamDesignBrainstormState | undefined {
  if (!state) {
    if (decision) failDecision('The Design has no active brainstorming step')
    return state
  }
  if (!decision) {
    return state.phase === 'reviewing_design' ? { ...state, approvedSectionIds: [] } : state
  }
  if (decision.type === 'select_approach') {
    if (!state.approaches.some(({ id }) => id === decision.approachId)) {
      failDecision(`Unknown Design approach: ${decision.approachId}`)
    }
    return { ...state, selectedApproachId: decision.approachId, approvedSectionIds: [] }
  }
  if (!state.sections.some(({ id }) => id === decision.sectionId)) {
    failDecision(`Unknown Design section: ${decision.sectionId}`)
  }
  return {
    ...state,
    approvedSectionIds: [...new Set([...state.approvedSectionIds, decision.sectionId])]
  }
}

export function mergeMamDesignBrainstorm(
  presentation: MamDesignBrainstormPresentation,
  previous: MamDesignBrainstormState | undefined,
  review: MamDesignReview
): MamDesignBrainstormState {
  const approaches = normalizeApproaches(
    presentation.approaches.length ? presentation.approaches : (previous?.approaches ?? [])
  )
  const sections = presentation.sections.length ? presentation.sections : (previous?.sections ?? [])
  const selectedApproachId = approaches.some(({ id }) => id === previous?.selectedApproachId)
    ? previous?.selectedApproachId
    : undefined
  const approvedSectionIds = retainedSectionApprovals(previous, sections)
  const phase = brainstormPhase({
    ...(presentation.question ? { question: presentation.question } : {}),
    approaches,
    ...(selectedApproachId ? { selectedApproachId } : {}),
    sections,
    approvedSectionIds,
    review
  })
  return {
    phase,
    ...(presentation.question ? { question: presentation.question } : {}),
    approaches,
    sections,
    ...(selectedApproachId ? { selectedApproachId } : {}),
    approvedSectionIds
  }
}

export function invalidateMamDesignBrainstorm(
  state: MamDesignBrainstormState | undefined
): MamDesignBrainstormState | undefined {
  return state ? { ...state, phase: 'reviewing_design', approvedSectionIds: [] } : undefined
}

function retainedSectionApprovals(
  previous: MamDesignBrainstormState | undefined,
  sections: MamDesignBrainstormPresentation['sections']
): string[] {
  if (!previous) return []
  return previous.approvedSectionIds.filter((id) => {
    const before = previous.sections.find((section) => section.id === id)
    const current = sections.find((section) => section.id === id)
    return before && current && before.title === current.title && before.summary === current.summary
  })
}

function brainstormPhase(input: {
  question?: MamDesignBrainstormPresentation['question']
  approaches: MamDesignBrainstormPresentation['approaches']
  selectedApproachId?: string
  sections: MamDesignBrainstormPresentation['sections']
  approvedSectionIds: readonly string[]
  review: MamDesignReview
}): MamDesignBrainstormState['phase'] {
  if (input.question) return 'clarifying'
  if (input.approaches.length < 2) return 'comparing_approaches'
  if (input.sections.length === 0) return 'comparing_approaches'
  if (input.sections.length < 3) return 'reviewing_design'
  return 'ready'
}

function normalizeApproaches(
  approaches: MamDesignBrainstormPresentation['approaches']
): MamDesignBrainstormPresentation['approaches'] {
  if (approaches.length === 0) return approaches
  const recommendedIndex = Math.max(
    0,
    approaches.findIndex(({ recommended }) => recommended)
  )
  return approaches.map((approach, index) => ({
    ...approach,
    recommended: index === recommendedIndex
  }))
}

function failDecision(message: string): never {
  return failMamDesignAssistant('design_brainstorm_decision_invalid', message)
}
