import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { mamUiSnapshotFixture } from './mam-renderer-snapshot-fixture'
import { MamWorkflowsPage } from './MamWorkflowsPage'

describe('MAM Workflows page', () => {
  it('keeps creation at the top and places package import in the bottom action row', () => {
    const snapshot = mamUiSnapshotFixture()
    const html = renderToStaticMarkup(
      <MamWorkflowsPage
        snapshot={snapshot}
        pending={false}
        onSaveWorkflow={async () => undefined}
        onCreateWorkflowRun={async () => snapshot}
        onSaveLocalSettings={async () => undefined}
        onImportWorkflowPackage={async () => undefined}
      />
    )

    expect(html).toContain('flex min-h-full w-full max-w-5xl flex-col')
    expect(html).toContain('class="mt-auto flex justify-end pt-6"')
    expect(html.indexOf('New Workflow')).toBeLessThan(
      html.indexOf('No active Workflow Definitions')
    )
    expect(html.indexOf('No active Workflow Definitions')).toBeLessThan(
      html.indexOf('Import package')
    )
  })

  it('offers Git-backed Run creation for an attached project', () => {
    const snapshot = mamUiSnapshotFixture()
    snapshot.projectBinding = {
      projectDirectory: '/project',
      stateDirectory: '/state',
      collaborationMode: 'distributed',
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
        onCreateWorkflowRun={async () => snapshot}
        onSaveLocalSettings={async () => undefined}
      />
    )

    expect(html).toContain('Start Run')
    expect(html).not.toContain('disabled=""')
  })
})
