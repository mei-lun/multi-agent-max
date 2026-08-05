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

  it('labels an existing Workflow optimization as a new version', () => {
    const markup = renderToStaticMarkup(
      <MamDesignProposalPanel
        draft={{
          schemaVersion: '1.0.0',
          id: 'design.revision',
          selectedModelProfileId: 'model.designer',
          workflowRevision: {
            workflowId: 'workflow.release',
            baseVersion: 1,
            nextVersion: 2
          },
          messages: [],
          proposal: {
            hash: 'a'.repeat(64),
            roles: [],
            workflow: {
              schemaVersion: '1.0.0',
              id: 'workflow.release',
              name: 'Release',
              version: 2,
              nodes: [{ id: 'finish', type: 'finish', inputs: [] }],
              edges: [],
              maxTransitions: 10,
              maxRunCostUsd: 5,
              maxRunDurationSeconds: 600
            },
            issues: [],
            createdAt: '2026-07-30T00:00:00Z'
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

    expect(markup).toContain('Workflow Revision')
    expect(markup).toContain('This revision reuses existing Role Profiles.')
    expect(markup).toContain('Confirm new version')
  })

  it('keeps confirmation available while the Design review has suggestions', () => {
    const markup = renderToStaticMarkup(
      <MamDesignProposalPanel
        draft={{
          schemaVersion: '1.0.0',
          id: 'design.clarification',
          selectedModelProfileId: 'model.designer',
          messages: [],
          proposal: {
            hash: 'b'.repeat(64),
            roles: [],
            workflow: {
              schemaVersion: '1.0.0',
              id: 'workflow.clarification',
              name: 'Clarification',
              version: 1,
              nodes: [{ id: 'finish', type: 'finish', inputs: [] }],
              edges: [],
              maxTransitions: 10,
              maxRunCostUsd: 5,
              maxRunDurationSeconds: 600
            },
            issues: [],
            createdAt: '2026-08-05T00:00:00Z'
          },
          review: {
            readiness: 'needs_clarification',
            questions: ['Who approves release?'],
            findings: [],
            assumptions: []
          },
          status: 'draft',
          createdAt: '2026-08-05T00:00:00Z',
          updatedAt: '2026-08-05T00:00:00Z'
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

    expect(markup).toContain('Assistant has questions · confirmation remains available')
    expect(markup).not.toContain('disabled=""')
  })
})
