import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '../../components/ui/tooltip'
import { MamDesignConversation } from './MamDesignConversation'

describe('MamDesignConversation', () => {
  it('shows the questions, Workflow findings, and assumptions for the next turn', () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <MamDesignConversation
          messages={[
            {
              id: 'design-message.assistant',
              role: 'assistant',
              content: 'I reviewed the current Workflow.',
              createdAt: '2026-08-05T00:00:00Z'
            }
          ]}
          review={{
            readiness: 'needs_clarification',
            questions: ['Who approves the final release?'],
            findings: [
              {
                severity: 'warning',
                status: 'unresolved',
                title: 'Release ownership is unclear',
                detail: 'No human decision point identifies the release owner.',
                recommendation: 'Choose the person responsible for final approval.'
              }
            ],
            assumptions: ['Draft work may proceed before release approval.']
          }}
          sending={false}
          disabled={false}
          onSend={async () => undefined}
          onDecision={async () => undefined}
          onCancel={async () => undefined}
        />
      </TooltipProvider>
    )

    expect(markup).toContain('Your input is needed')
    expect(markup).toContain('Who approves the final release?')
    expect(markup).toContain('Release ownership is unclear')
    expect(markup).toContain('Draft work may proceed before release approval.')
  })
})
