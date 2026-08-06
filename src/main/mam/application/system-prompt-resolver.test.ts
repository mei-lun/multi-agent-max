import { describe, expect, it } from 'vitest'
import { withHumanInteractionPolicy } from './system-prompt-resolver'

describe('withHumanInteractionPolicy', () => {
  it('does not require confirmation for an already clear Task', () => {
    const prompt = withHumanInteractionPolicy('Complete the specified output.')

    expect(prompt).toContain('If the work is clear, proceed without calling')
    expect(prompt).toContain(
      'Call mam_confirm_understanding only after mam_ask_user succeeded for the same interaction'
    )
    expect(prompt).toContain('Never call the confirmation tool proactively')
  })
})
