import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { mamUiSnapshotFixture } from './mam-renderer-snapshot-fixture'
import { MamDesignProposalPanel } from './MamDesignProposalPanel'

describe('MamDesignProposalPanel', () => {
  it('keeps generation recovery actions visible without a proposal', () => {
    const markup = renderToStaticMarkup(
      <MamDesignProposalPanel
        draft={{
          schemaVersion: '1.0.0',
          id: 'design.recovery',
          selectedModelProfileId: 'model.designer',
          messages: [],
          recovery: {
            code: 'design_model_response_invalid',
            message: 'The generated response was incomplete.',
            issues: [],
            attempts: 3,
            occurredAt: '2026-07-30T00:00:00Z'
          },
          status: 'draft',
          createdAt: '2026-07-30T00:00:00Z',
          updatedAt: '2026-07-30T00:00:00Z'
        }}
        snapshot={mamUiSnapshotFixture()}
        pending={false}
        onUpdateRole={async () => undefined}
        onEditWorkflow={() => undefined}
        onApply={async () => undefined}
        onCreateTemplate={async () => undefined}
        onRetry={async () => undefined}
      />
    )

    expect(markup).toContain('Generation needs recovery')
    expect(markup).toContain('Retry generation')
    expect(markup).toContain('Load standard template')
    expect(markup).toContain('Use standard template')
  })
})
