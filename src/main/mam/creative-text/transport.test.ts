import { expect, test } from 'vitest'
import { createServer } from 'node:http'
import type { ProviderProtocol } from '../../../shared/mam/domain/execution-profile'
import { createCreativeTextServices } from './index'
import { executeText } from './transport'

test('cancellation before dispatch is sanitized and sends no request', async () => {
  const controller = new AbortController()
  controller.abort(new Error('private credential detail'))
  let fetched = false
  await expect(
    executeText({
      model: {
        id: 'm',
        version: 1,
        displayName: 'm',
        providerProfileId: 'p',
        remoteModelId: 'm',
        capabilities: {
          modalities: ['text'],
          supportsTools: false,
          supportsStructuredOutput: false
        }
      },
      provider: { id: 'p', version: 1, protocol: 'openai-responses' },
      params: { modelProfileId: 'm', prompt: 'prompt' },
      secret: undefined,
      fetcher: async () => {
        fetched = true
        throw new Error('secret')
      },
      context: { signal: controller.signal, emit: async () => {} }
    })
  ).rejects.toThrow('Text generation cancelled or timed out')
  expect(fetched).toBe(false)
})

const protocols: [ProviderProtocol, unknown[]][] = [
  [
    'openai-responses',
    [{ type: 'response.output_text.delta', delta: 'hello' }, { type: 'response.completed' }]
  ],
  [
    'openai-completions',
    [
      { choices: [{ delta: { content: 'hello' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      '[DONE]'
    ]
  ],
  [
    'anthropic-messages',
    [
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      { type: 'message_stop' }
    ]
  ],
  [
    'google-generative-ai',
    [{ candidates: [{ content: { parts: [{ text: 'hello' }] }, finishReason: 'STOP' }] }]
  ]
]
for (const [protocol, events] of protocols)
  test(`fragmented HTTP SSE ${protocol} freezes identity`, async () => {
    let received: Record<string, unknown> = {}
    const server = createServer(async (req, res) => {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      received = JSON.parse(Buffer.concat(chunks).toString())
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const data = events
        .map((value) => `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`)
        .join('')
      for (let i = 0; i < data.length; i += 3) res.write(data.slice(i, i + 3))
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const model = {
      id: 'model',
      version: 1,
      displayName: 'Text',
      providerProfileId: 'provider',
      remoteModelId: 'text-model',
      capabilities: {
        modalities: ['text'] as ['text'],
        supportsTools: true,
        supportsStructuredOutput: false
      }
    }
    const provider = {
      id: 'provider',
      version: 1,
      protocol,
      baseUrl: `http://127.0.0.1:${address.port}/v1/`,
      secretRef: 'key'
    }
    const service = createCreativeTextServices({
      catalog: {
        models: { listActive: () => [model], getActive: () => model },
        providers: { getActive: () => provider }
      },
      resolveSecret: () => 'secret'
    })
    const request = {
      componentId: 'creative.writing',
      componentVersion: '1.0.0',
      projectId: 'p',
      operation: 'text.generate',
      idempotencyKey: 'one',
      inputAssets: [],
      params: { modelProfileId: 'model', prompt: 'hello' }
    }
    try {
      const handler = service.handlers(request)!
      model.remoteModelId = 'changed'
      provider.baseUrl = 'http://invalid.invalid/'
      const deltas: unknown[] = []
      expect(
        await handler.run(request, {
          signal: new AbortController().signal,
          emit: async (_type, data) => {
            deltas.push(data)
          }
        })
      ).toEqual({ text: 'hello' })
      expect(deltas).toEqual([{ type: 'text_delta', text: 'hello' }])
      expect(received.tools).toBeUndefined()
      if (protocol !== 'google-generative-ai') expect(received.model).toBe('text-model')
      expect(() =>
        service.handlers({ ...request, params: { ...request.params, tools: [] } })
      ).toThrow()
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

test.each([
  'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
  'data: [DONE]\n\n',
  'data: {"choices":[{"delta":{"tool_calls":[{}]}}]}\n\ndata: [DONE]\n\n'
])('rejects interrupted, empty and tool streams', async (stream) => {
  const model = {
    id: 'm',
    version: 1,
    displayName: 'Text',
    providerProfileId: 'p',
    remoteModelId: 'chat',
    capabilities: {
      modalities: ['text'] as ['text'],
      supportsTools: true,
      supportsStructuredOutput: false
    }
  }
  const service = createCreativeTextServices({
    catalog: {
      models: { listActive: () => [model], getActive: () => model },
      providers: { getActive: () => ({ id: 'p', version: 1, protocol: 'openai-completions' }) }
    },
    resolveSecret: () => undefined,
    fetch: async () => new Response(stream)
  })
  const request = {
    componentId: 'c',
    componentVersion: '1',
    projectId: 'p',
    operation: 'text.generate',
    idempotencyKey: 'k',
    params: { modelProfileId: 'm', prompt: 'prompt' },
    inputAssets: []
  }
  await expect(
    service
      .handlers(request)!
      .run(request, { signal: new AbortController().signal, emit: async () => {} })
  ).rejects.toThrow('Text generation failed')
})
