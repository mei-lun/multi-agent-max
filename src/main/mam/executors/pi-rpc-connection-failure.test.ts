import { describe, expect, it } from 'vitest'
import { classifyPiRpcFailure, isRetryableConnectionFailure } from './pi-rpc-connection-failure'

describe('Pi connection failure classification', () => {
  it.each([
    ['Request timed out', 'executor_timeout'],
    ['fetch failed: ECONNRESET', 'executor_connection_failed'],
    ['HTTP 503 temporarily unavailable', 'executor_connection_failed'],
    ['429 rate limit exceeded', 'executor_connection_failed'],
    ['Provider rejected invalid API key', 'executor_process_failed']
  ] as const)('classifies %s', (message, expected) => {
    expect(classifyPiRpcFailure(message)).toBe(expected)
    expect(isRetryableConnectionFailure(expected)).toBe(expected !== 'executor_process_failed')
  })
})
