import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MamOverviewPage } from './MamOverviewPage'
import { mamUiSnapshotFixture } from './mam-renderer-snapshot-fixture'

describe('MAM Overview page', () => {
  it('shows an attached empty project instead of asking the user to choose one', () => {
    const snapshot = mamUiSnapshotFixture()
    snapshot.runs = []
    snapshot.projectBinding = {
      projectDirectory: '/projects/empty-flow',
      stateDirectory: '/projects/.empty-flow-mam-state',
      collaborationMode: 'distributed',
      remote: 'origin',
      branch: 'mam-state'
    }

    const html = renderToStaticMarkup(
      <MamOverviewPage snapshot={snapshot} pending={false} onChooseProject={() => undefined} />
    )

    expect(html).toContain('Connected project')
    expect(html).toContain('/projects/empty-flow')
    expect(html).toContain('origin/mam-state')
    expect(html).toContain('No Workflow Runs yet')
    expect(html).not.toContain('Choose a Git project to attach its authoritative MAM state.')
  })
})
