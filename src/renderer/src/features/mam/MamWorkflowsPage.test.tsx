import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { mamUiSnapshotFixture } from './mam-renderer-snapshot-fixture'
import { MamWorkflowsPage } from './MamWorkflowsPage'

describe('MAM Workflows page', () => {
  it('offers Git-backed Run creation for an attached project', () => {
    const snapshot = mamUiSnapshotFixture()
    snapshot.projectBinding = {
      projectDirectory: '/project',
      stateDirectory: '/state',
      remote: 'origin',
      branch: 'mam-state'
    }
    snapshot.workflows.push({
      schemaVersion: '1.0.0',
      id: 'workflow.release',
      name: 'Release',
      version: 1,
      nodes: [{ id: 'finish', type: 'finish', inputs: [] }],
      edges: [],
      maxTransitions: 10,
      maxRunCostUsd: 5,
      maxRunDurationSeconds: 600
    })

    const html = renderToStaticMarkup(
      <MamWorkflowsPage
        snapshot={snapshot}
        pending={false}
        onSaveWorkflow={async () => undefined}
        onCreateWorkflowRun={async () => undefined}
      />
    )

    expect(html).toContain('Start Run')
    expect(html).not.toContain('disabled=""')
  })
})
