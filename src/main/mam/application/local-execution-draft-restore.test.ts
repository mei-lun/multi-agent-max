import { describe, expect, it } from 'vitest'
import { restoredPreparedFields } from './local-execution-draft-restore'

describe('restoredPreparedFields', () => {
  it('restores the persisted timeout continuation count', () => {
    expect(
      restoredPreparedFields({
        claimId: 'claim.test',
        claimGeneration: 1,
        formalRevisionNumber: 0,
        continuationAttempts: 1,
        roleInstanceId: 'role-instance.test',
        id: 'draft.attempt.test',
        sessionDirectory: 'C:/missing-session'
      } as never)
    ).toMatchObject({ continuationAttempts: 1 })
  })

  it('defaults older Drafts to zero continuations', () => {
    expect(
      restoredPreparedFields({
        claimId: 'claim.test',
        claimGeneration: 1,
        formalRevisionNumber: 0,
        roleInstanceId: 'role-instance.test',
        id: 'draft.attempt.test',
        sessionDirectory: 'C:/missing-session'
      } as never)
    ).toMatchObject({ continuationAttempts: 0 })
  })
})
