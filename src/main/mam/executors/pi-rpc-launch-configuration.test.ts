import { describe, expect, it } from 'vitest'
import { piProviderBaseUrl } from './pi-rpc-launch-configuration'

describe('Pi provider API base URL', () => {
  it.each(['openai-responses', 'openai-completions'] as const)(
    'defaults bare %s origins to /v1 without changing custom prefixes',
    (protocol) => {
      for (const origin of ['https://relay.example.test', 'https://relay.example.test/']) {
        expect(piProviderBaseUrl(protocol, origin)).toBe('https://relay.example.test/v1')
      }
      for (const path of ['/v1', '/v1/', '/proxy/v2', '/proxy/v2/']) {
        expect(piProviderBaseUrl(protocol, `https://relay.example.test${path}`)).toBe(
          `https://relay.example.test${path.replace(/\/$/, '')}`
        )
      }
    }
  )

  it.each([
    ['openai-responses', '/responses'],
    ['openai-completions', '/chat/completions']
  ] as const)('strips only the %s operation path that the SDK appends', (protocol, suffix) => {
    for (const prefix of ['', '/v1', '/proxy/v2']) {
      for (const trailing of ['', '/']) {
        expect(
          piProviderBaseUrl(protocol, `https://relay.example.test${prefix}${suffix}${trailing}`)
        ).toBe(`https://relay.example.test${prefix}`)
      }
    }
  })

  it.each(['anthropic-messages', 'google-generative-ai', 'executor-native'] as const)(
    'preserves %s endpoint semantics',
    (protocol) => {
      const configured = 'https://relay.example.test/custom/'
      expect(piProviderBaseUrl(protocol, configured)).toBe(configured)
    }
  )
})
