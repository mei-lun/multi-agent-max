import { describe, expect, it } from 'vitest'
import type { MamDesignBrainstormPresentation } from '../../../shared/mam/design-brainstorm'
import type { MamDesignReview } from '../../../shared/mam/design-proposal'
import {
  applyMamDesignBrainstormDecision,
  invalidateMamDesignBrainstorm,
  mergeMamDesignBrainstorm
} from './mam-design-conversation-state'

const readyReview: MamDesignReview = {
  readiness: 'ready',
  questions: [],
  findings: [],
  assumptions: []
}

describe('MAM Design brainstorming state', () => {
  it('asks exactly one structured question before comparing approaches', () => {
    const state = mergeMamDesignBrainstorm(
      {
        question: {
          id: 'approval-owner',
          prompt: 'Who owns final approval?',
          whyItMatters: 'This determines the human decision gate.',
          options: []
        },
        approaches: [],
        sections: []
      },
      undefined,
      readyReview
    )

    expect(state).toMatchObject({
      phase: 'clarifying',
      question: { id: 'approval-owner' },
      approvedSectionIds: []
    })
  })

  it('preserves an optional approach choice across model turns', () => {
    const comparison = mergeMamDesignBrainstorm(approachPresentation(), undefined, readyReview)

    expect(comparison.phase).toBe('comparing_approaches')

    const selected = applyMamDesignBrainstormDecision(comparison, {
      type: 'select_approach',
      approachId: 'balanced'
    })!
    const next = mergeMamDesignBrainstorm(approachPresentation(), selected, readyReview)

    expect(next).toMatchObject({
      phase: 'comparing_approaches',
      selectedApproachId: 'balanced'
    })
  })

  it('keeps complete design suggestions ready without section approvals', () => {
    const comparison = mergeMamDesignBrainstorm(approachPresentation(), undefined, readyReview)
    const selected = applyMamDesignBrainstormDecision(comparison, {
      type: 'select_approach',
      approachId: 'balanced'
    })!
    const review = mergeMamDesignBrainstorm(sectionPresentation(), selected, readyReview)
    const ownershipApproved = applyMamDesignBrainstormDecision(review, {
      type: 'approve_section',
      sectionId: 'ownership'
    })!
    const afterFirstApproval = mergeMamDesignBrainstorm(
      sectionPresentation(),
      ownershipApproved,
      readyReview
    )
    const flowApproved = applyMamDesignBrainstormDecision(afterFirstApproval, {
      type: 'approve_section',
      sectionId: 'flow'
    })!
    const afterSecondApproval = mergeMamDesignBrainstorm(
      sectionPresentation(),
      flowApproved,
      readyReview
    )
    const qualityApproved = applyMamDesignBrainstormDecision(afterSecondApproval, {
      type: 'approve_section',
      sectionId: 'quality'
    })!
    const ready = mergeMamDesignBrainstorm(sectionPresentation(), qualityApproved, readyReview)

    expect(review).toMatchObject({
      phase: 'ready',
      approvedSectionIds: []
    })

    const changed = sectionPresentation()
    changed.sections[0] = { ...changed.sections[0]!, summary: 'Changed ownership design.' }
    const invalidated = mergeMamDesignBrainstorm(changed, ready, readyReview)

    expect(invalidated.phase).toBe('ready')
    expect(invalidated.approvedSectionIds).toEqual(['flow', 'quality'])
  })

  it('rejects model or renderer decisions that do not match the current state', () => {
    const comparison = mergeMamDesignBrainstorm(approachPresentation(), undefined, readyReview)

    expect(() =>
      applyMamDesignBrainstormDecision(comparison, {
        type: 'select_approach',
        approachId: 'missing'
      })
    ).toThrow('Unknown Design approach')
  })

  it('revokes section approvals after a manual proposal edit', () => {
    const state = mergeMamDesignBrainstorm(
      sectionPresentation(),
      {
        ...mergeMamDesignBrainstorm(sectionPresentation(), undefined, readyReview),
        selectedApproachId: 'balanced',
        approvedSectionIds: ['ownership', 'flow', 'quality']
      },
      readyReview
    )

    expect(invalidateMamDesignBrainstorm(state)).toMatchObject({
      phase: 'reviewing_design',
      approvedSectionIds: []
    })
  })
})

function approachPresentation(): MamDesignBrainstormPresentation {
  return {
    approaches: [
      {
        id: 'balanced',
        title: 'Balanced review',
        summary: 'Use one author and one independent reviewer.',
        benefits: ['Clear ownership'],
        tradeoffs: ['One additional review step'],
        recommended: true
      },
      {
        id: 'fast',
        title: 'Fast path',
        summary: 'Use one author with final human approval.',
        benefits: ['Lower latency'],
        tradeoffs: ['Less independent validation'],
        recommended: false
      }
    ],
    sections: []
  }
}

function sectionPresentation(): MamDesignBrainstormPresentation {
  return {
    ...approachPresentation(),
    sections: [
      {
        id: 'ownership',
        title: 'Roles and ownership',
        summary: 'Author and reviewer are separate.'
      },
      { id: 'flow', title: 'Workflow and handoffs', summary: 'Review precedes final approval.' },
      { id: 'quality', title: 'Quality and recovery', summary: 'Failures return to revision.' }
    ]
  }
}
