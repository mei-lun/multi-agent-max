import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MamDesignBrainstormPanel } from './MamDesignBrainstormPanel'

describe('MamDesignBrainstormPanel', () => {
  it('renders approach trade-offs and design sections', () => {
    const markup = renderToStaticMarkup(
      <MamDesignBrainstormPanel
        brainstorm={{
          phase: 'reviewing_design',
          approaches: [
            {
              id: 'balanced',
              title: 'Balanced review',
              summary: 'Separate delivery and review ownership.',
              benefits: ['Independent review'],
              tradeoffs: ['Additional latency'],
              recommended: true
            },
            {
              id: 'fast',
              title: 'Fast path',
              summary: 'Use final human approval only.',
              benefits: ['Fewer stages'],
              tradeoffs: ['Less validation'],
              recommended: false
            }
          ],
          selectedApproachId: 'balanced',
          sections: [
            { id: 'ownership', title: 'Roles and ownership', summary: 'Separate the roles.' },
            { id: 'flow', title: 'Workflow and handoffs', summary: 'Review before approval.' }
          ],
          approvedSectionIds: ['ownership']
        }}
        pending={false}
        onAnswer={async () => undefined}
        onDecision={async () => undefined}
      />
    )

    expect(markup).toContain('Balanced review')
    expect(markup).toContain('Recommended')
    expect(markup).toContain('Additional latency')
    expect(markup).toContain('Roles and ownership')
    expect(markup).toContain('Reply with requested changes when you want a different direction.')
  })
})
