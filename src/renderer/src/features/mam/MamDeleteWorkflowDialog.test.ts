import { describe, expect, it } from 'vitest'
import { mamUiSnapshotFixture } from './mam-renderer-snapshot-fixture'
import { workflowRemovalRunCount } from './MamDeleteWorkflowDialog'

describe('Workflow removal impact', () => {
  it('counts historical Runs without treating them as deletable definitions', () => {
    const snapshot = mamUiSnapshotFixture()
    expect(workflowRemovalRunCount(snapshot, snapshot.runs[0]!.run.definitionId)).toBe(1)
    expect(workflowRemovalRunCount(snapshot, 'workflow.unused')).toBe(0)
  })
})
