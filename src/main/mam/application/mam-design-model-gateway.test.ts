import { describe, expect, it } from 'vitest'
import type {
  ModelProfile,
  ProviderProfile,
  ProviderProtocol
} from '../../../shared/mam/domain/execution-profile'
import {
  MamDesignModelGateway,
  MAM_DESIGN_RESPONSE_SCHEMA_NAME,
  buildDesignModelEndpoint,
  buildDesignModelRequestBody,
  designResponseJsonSchema,
  extractDesignModelText
} from './mam-design-model-gateway'

describe('MAM Design Model gateway', () => {
  it.each([
    ['openai-responses', 'https://api.example.test/v1/responses'],
    ['openai-completions', 'https://api.example.test/v1/chat/completions'],
    ['anthropic-messages', 'https://api.example.test/v1/messages'],
    ['google-generative-ai', 'https://api.example.test/v1/models/designer-model:generateContent']
  ] as const)('builds the %s endpoint', (protocol, expected) => {
    expect(buildDesignModelEndpoint(provider(protocol), model())).toBe(expected)
  })

  it.each([
    [
      'openai-responses',
      {
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"message":"ok"}' }] }]
      }
    ],
    [
      'openai-completions',
      { choices: [{ message: { role: 'assistant', content: '{"message":"ok"}' } }] }
    ],
    ['anthropic-messages', { content: [{ type: 'text', text: '{"message":"ok"}' }] }],
    [
      'google-generative-ai',
      { candidates: [{ content: { parts: [{ text: '{"message":"ok"}' }] } }] }
    ]
  ] as const)('extracts text from %s', (protocol, response) => {
    expect(extractDesignModelText(protocol, JSON.stringify(response))).toBe('{"message":"ok"}')
  })

  it('attaches the full JSON Schema to OpenAI Responses', () => {
    const body = buildDesignModelRequestBody(gatewayInput('openai-responses'))

    expect(body).toMatchObject({
      text: {
        format: {
          type: 'json_schema',
          name: MAM_DESIGN_RESPONSE_SCHEMA_NAME,
          strict: false,
          schema: designResponseJsonSchema()
        }
      }
    })
  })

  it('attaches the full JSON Schema to OpenAI Chat Completions', () => {
    const body = buildDesignModelRequestBody(gatewayInput('openai-completions'))

    expect(body).toMatchObject({
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: MAM_DESIGN_RESPONSE_SCHEMA_NAME,
          strict: false,
          schema: designResponseJsonSchema()
        }
      }
    })
  })

  it('attaches the full JSON Schema to Google GenerateContent', () => {
    const body = buildDesignModelRequestBody(gatewayInput('google-generative-ai'))

    expect(body).toMatchObject({
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: designResponseJsonSchema()
      }
    })
  })

  it('keeps Anthropic on the prompt-constrained compatibility path', () => {
    const body = buildDesignModelRequestBody(gatewayInput('anthropic-messages'))

    expect(body).not.toHaveProperty('response_format')
    expect(body).not.toHaveProperty('text')
    expect(body).not.toHaveProperty('generationConfig')
  })

  it('keeps credentials in the main-process request and sends bounded conversation history', async () => {
    let request: Readonly<{ url: string; init: RequestInit }> | undefined
    const gateway = new MamDesignModelGateway(async (url, init) => {
      request = { url, init }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"message":"Draft ready"}' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })

    await expect(
      gateway.generate({
        model: model(),
        provider: provider('openai-completions'),
        credential: 'secret-value',
        systemPrompt: 'Return JSON.',
        messages: [
          {
            id: 'design-message.one',
            role: 'user',
            content: 'Create a workflow.',
            createdAt: '2026-07-29T12:00:00Z'
          }
        ]
      })
    ).resolves.toBe('{"message":"Draft ready"}')

    expect(request?.url).toBe('https://api.example.test/v1/chat/completions')
    expect(new Headers(request?.init.headers).get('authorization')).toBe('Bearer secret-value')
    expect(JSON.parse(String(request?.init.body))).toMatchObject({
      model: 'designer-model',
      store: false,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: MAM_DESIGN_RESPONSE_SCHEMA_NAME,
          strict: false
        }
      },
      messages: [
        { role: 'system', content: 'Return JSON.' },
        { role: 'user', content: 'Create a workflow.' }
      ]
    })
  })

  it('sends the Anthropic protocol version through a credential-free relay', async () => {
    let headers: Headers | undefined
    const { secretRef: _secretRef, ...credentialFreeProvider } = provider('anthropic-messages')
    const gateway = new MamDesignModelGateway(async (_url, init) => {
      headers = new Headers(init.headers)
      return new Response(
        JSON.stringify({ content: [{ type: 'text', text: '{"message":"ok"}' }] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
    })

    await gateway.generate({
      model: model(),
      provider: credentialFreeProvider,
      systemPrompt: 'Return JSON.',
      messages: []
    })

    expect(headers?.get('anthropic-version')).toBe('2023-06-01')
    expect(headers?.has('x-api-key')).toBe(false)
  })

  it('falls back to portable JSON mode when a relay rejects JSON Schema', async () => {
    const requestBodies: Record<string, unknown>[] = []
    const gateway = new MamDesignModelGateway(async (_url, init) => {
      requestBodies.push(JSON.parse(String(init.body)))
      if (requestBodies.length === 1) {
        return new Response(JSON.stringify({ error: { code: 'unsupported_response_format' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        })
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"message":"ok"}' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })

    await expect(gateway.generate(gatewayInput('openai-completions'))).resolves.toBe(
      '{"message":"ok"}'
    )
    expect(requestBodies[0]).toMatchObject({ response_format: { type: 'json_schema' } })
    expect(requestBodies[1]).toMatchObject({ response_format: { type: 'json_object' } })
  })

  it('removes schema metadata unsupported by provider response formats', () => {
    const serialized = JSON.stringify(designResponseJsonSchema())

    expect(serialized).not.toContain('"$schema"')
    expect(serialized).not.toContain('"default"')
  })

  it('requires the structured brainstorming envelope in generated responses', () => {
    const schema = designResponseJsonSchema()

    expect(schema).toMatchObject({
      properties: {
        brainstorm: {
          properties: {
            question: { type: 'object' },
            approaches: { type: 'array', maxItems: 3 },
            sections: { type: 'array', maxItems: 8 }
          }
        }
      },
      required: expect.arrayContaining(['brainstorm'])
    })
  })
})

function provider(protocol: ProviderProtocol): ProviderProfile {
  return {
    id: `provider.${protocol}`,
    version: 1,
    protocol,
    baseUrl: 'https://api.example.test/v1',
    secretRef: 'secret.designer'
  }
}

function model(): ModelProfile {
  return {
    id: 'model.designer',
    version: 1,
    displayName: 'Designer model',
    providerProfileId: 'provider.designer',
    remoteModelId: 'designer-model',
    capabilities: {
      modalities: ['text'],
      supportsTools: false,
      supportsStructuredOutput: true
    }
  }
}

function gatewayInput(protocol: ProviderProtocol) {
  return {
    model: model(),
    provider: provider(protocol),
    systemPrompt: 'Return a complete Design response.',
    messages: []
  }
}
