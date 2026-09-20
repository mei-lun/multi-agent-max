import { describe, expect, it } from 'vitest'
import { piArguments, piModels, piProviderBaseUrl } from './pi-rpc-launch-configuration'

describe('Pi provider API base URL', () => {
  it('declares Responses reasoning support and maps the configured effort to Pi thinking', () => {
    const snapshot = testSnapshot({ reasoningEffort: 'medium' })
    const providers = piModels(snapshot).providers as Record<string, unknown>
    expect(providers['provider.test']).toMatchObject({
      models: [{ reasoning: true, thinkingLevelMap: { medium: 'medium' } }]
    })
    expect(piArguments(snapshot, 'system', 'session', [], undefined, [])).toContain('medium')
  })
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

  it.each(['openai-responses', 'openai-completions'] as const)(
    'strips any OpenAI operation path for %s before the SDK appends its selected operation',
    (protocol) => {
      for (const prefix of ['', '/v1', '/proxy/v2']) {
        for (const suffix of ['/responses', '/chat/completions', '/models']) {
          for (const trailing of ['', '/']) {
            expect(
              piProviderBaseUrl(protocol, `https://relay.example.test${prefix}${suffix}${trailing}`)
            ).toBe(`https://relay.example.test${prefix || '/v1'}`)
          }
        }
      }
    }
  )

  it.each(['anthropic-messages', 'google-generative-ai', 'executor-native'] as const)(
    'preserves %s endpoint semantics',
    (protocol) => {
      const configured = 'https://relay.example.test/custom/'
      expect(piProviderBaseUrl(protocol, configured)).toBe(configured)
    }
  )
})

function testSnapshot(inference: Record<string, unknown>) {
  return {
    providerProfile: { id: 'provider.test' },
    execution: {
      providerProtocol: 'openai-responses',
      providerBaseUrl: 'https://relay.example.test/v1',
      providerSecretRef: 'secret.test',
      remoteModelId: 'gpt-5.6-sol',
      inference
    },
    contextPolicy: { maxContextTokens: 100_000 },
    budget: { maxOutputTokens: 8_192, maxDurationSeconds: 300 },
    permissions: { readPaths: [], writePaths: [] },
    tools: []
  } as never
}
