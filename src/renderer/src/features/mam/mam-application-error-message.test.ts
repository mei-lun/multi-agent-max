import { describe, expect, it } from 'vitest'
import { mamApplicationErrorMessage } from './mam-application-error-message'

describe('MAM application error messages', () => {
  it('removes Electron IPC implementation details', () => {
    expect(
      mamApplicationErrorMessage(
        new Error("Error invoking remote method 'mam:start-attempt': Error: task failed")
      )
    ).toBe('task failed')
  })

  it('explains a reconciliation boundary', () => {
    expect(mamApplicationErrorMessage(new Error('task_not_startable:needs_attention'))).toBe(
      'Open this Task and confirm whether it is safe to retry.'
    )
  })

  it('turns a missing executor into a concrete setup request', () => {
    expect(mamApplicationErrorMessage(new Error('executor_profile_not_found'))).toBe(
      'Choose an available local Executor for this Role, then start the collaboration again.'
    )
  })

  it('does not expose an unknown Scheduler code as the user instruction', () => {
    expect(
      mamApplicationErrorMessage(
        new Error(
          "Error invoking remote method 'mam:start-attempt': SchedulerCommandRejectedError: stale_attempt"
        )
      )
    ).toBe('MAM could not continue this action. Open the affected Task to see what is needed.')
  })
})
