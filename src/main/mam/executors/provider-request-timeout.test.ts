import { describe, expect, it } from 'vitest'
import { providerRequestTimeoutMs } from './provider-request-timeout'

describe('providerRequestTimeoutMs', () => {
  it('bounds Provider requests between 60 and 300 seconds', () => {
    expect(providerRequestTimeoutMs(1_800_000)).toBe(300_000)
    expect(providerRequestTimeoutMs(240_000)).toBe(60_000)
    expect(providerRequestTimeoutMs(400_000)).toBe(100_000)
  })

  it('rejects a request when the Attempt budget cannot preserve settlement time', () => {
    expect(() => providerRequestTimeoutMs(65_000)).toThrow('attempt_budget_insufficient')
  })
})
