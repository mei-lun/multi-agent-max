import { describe, expect, it, vi } from 'vitest'
import {
  buildModelCatalogEndpoint,
  MamProviderModelCatalogService,
  parseModelCatalog
} from './provider-model-catalog'

describe('Provider model catalog', () => {
  it('normalizes versioned relay endpoints without requesting v1 twice', () => {
    expect(
      buildModelCatalogEndpoint({
        protocol: 'openai-completions',
        baseUrl: 'https://relay.example.test/v1'
      })
    ).toBe('https://relay.example.test/v1/models')
    expect(
      buildModelCatalogEndpoint({
        protocol: 'google-generative-ai',
        baseUrl: 'https://generativelanguage.example.test/v1beta'
      })
    ).toBe('https://generativelanguage.example.test/v1beta/models')
  })

  it('accepts OpenAI and Gemini model-list response shapes', () => {
    expect(parseModelCatalog('{"data":[{"id":"gpt-5"},{"id":"gpt-5"}]}')).toEqual([{ id: 'gpt-5' }])
    expect(
      parseModelCatalog('{"models":[{"name":"models/gemini-2.5-pro","displayName":"Gemini Pro"}]}')
    ).toEqual([{ id: 'gemini-2.5-pro', displayName: 'Gemini Pro' }])
  })

  it('sends the selected protocol authentication header without exposing it in the result', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response('{"data":[{"id":"relay-model"}]}', {
        headers: { 'content-type': 'application/json' }
      })
    )
    const service = new MamProviderModelCatalogService(fetcher)

    await expect(
      service.fetch({
        protocol: 'openai-responses',
        baseUrl: 'https://relay.example.test/v1',
        apiKey: 'secret-value'
      })
    ).resolves.toEqual({ models: [{ id: 'relay-model' }] })

    expect(fetcher).toHaveBeenCalledWith(
      'https://relay.example.test/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer secret-value' })
      })
    )
  })
})
