import { expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BinaryAssetStore } from '../creative-runtime/assets'
import { createCreativeTextServices } from './index'
import type { ProviderProtocol } from '../../../shared/mam/domain/execution-profile'
import type { AssetRef } from '../../../shared/mam/creative-runtime'

test.each<ProviderProtocol>([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai'
])('%s vision sends verified ordered images and rejects bad refs', async (protocol) => {
  const root = await mkdtemp(join(tmpdir(), 'vision-'))
  const assets = await BinaryAssetStore.open(root)
  const refs: AssetRef[] = []
  for (const value of ['first', 'second'])
    refs.push(
      await assets.import(
        (async function* () {
          yield Buffer.from(value)
        })(),
        { filename: 'image.png', mime: 'image/png' }
      )
    )
  let body = '',
    authorization = '',
    calls = 0,
    secret = 'initial'
  const model = {
    id: 'm',
    version: 1,
    displayName: 'm',
    providerProfileId: 'p',
    remoteModelId: 'vision',
    capabilities: {
      modalities: ['text', 'image'] as ('text' | 'image')[],
      supportsTools: false,
      supportsStructuredOutput: false
    }
  }
  const provider = { id: 'p', version: 1, protocol, secretRef: 'key' }
  const service = createCreativeTextServices({
    catalog: {
      models: { listActive: () => [model], getActive: () => model },
      providers: { getActive: () => provider }
    },
    resolveSecret: () => secret,
    assets,
    validateImage: () => 'image/png',
    fetch: async (_url, init) => {
      calls++
      body = String(init?.body)
      authorization =
        new Headers(init?.headers).get(
          protocol === 'anthropic-messages'
            ? 'x-api-key'
            : protocol === 'google-generative-ai'
              ? 'x-goog-api-key'
              : 'Authorization'
        ) || ''
      const events =
        protocol === 'openai-responses'
          ? [{ type: 'response.output_text.delta', delta: 'ok' }, { type: 'response.completed' }]
          : protocol === 'openai-completions'
            ? [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]
            : protocol === 'anthropic-messages'
              ? [
                  { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } },
                  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
                  { type: 'message_stop' }
                ]
              : [{ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }]
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''))
    }
  })
  const request = {
    componentId: 'c',
    componentVersion: '1',
    projectId: 'p',
    operation: 'vision.generate',
    idempotencyKey: 'k',
    params: { modelProfileId: 'm', prompt: 'look', systemPrompt: 'system' },
    inputAssets: refs
  }
  const context = { signal: new AbortController().signal, emit: async () => {} }
  try {
    expect(service.listModels()[0]?.supportsVision).toBe(true)
    const handler = service.handlers(request)!
    secret = 'replacement'
    expect(await handler.run(request, context)).toEqual({ text: 'ok' })
    expect(authorization).toContain('initial')
    expect(body).toContain('system')
    expect(body.indexOf(Buffer.from('first').toString('base64'))).toBeLessThan(
      body.indexOf(Buffer.from('second').toString('base64'))
    )
    expect(body).toContain(
      protocol === 'openai-responses'
        ? 'input_image'
        : protocol === 'openai-completions'
          ? 'image_url'
          : protocol === 'anthropic-messages'
            ? 'media_type'
            : 'inlineData'
    )
    await expect(
      service
        .handlers({ ...request, inputAssets: [{ ...refs[0]!, sha256: '0'.repeat(64) }] })!
        .run(request, context)
    ).rejects.toThrow()
    expect(calls).toBe(1)
    expect(() => service.handlers({ ...request, inputAssets: Array(17).fill(refs[0]) })).toThrow(
      'budget'
    )
    expect(() => service.handlers({ ...request, operation: 'text.generate' })).toThrow(
      'prompt only'
    )
    model.capabilities.modalities = ['text']
    expect(() => service.handlers(request)).toThrow('Vision unavailable')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
