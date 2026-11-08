import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from 'vitest'
import { BinaryAssetStore } from '../creative-runtime/assets'
import { createMediaServices } from './index'
import type { CreativeRequest } from '../../../shared/mam/creative-runtime'

test('real HTTP images and speech freeze model and credential, errors never retry', async () => {
  const calls: { path: string; auth: string | undefined; body: string }[] = []
  let batchFailures = 0
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64'
  )
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk.toString()
    calls.push({ path: req.url!, auth: req.headers.authorization, body })
    if (body.includes('partial') && batchFailures++ === 0) {
      res.writeHead(503)
      res.end()
      return
    }
    if (body.includes('invalid-output')) {
      res.end('{"data":[{"b64_json":"aGVsbG8="}]}')
      return
    }
    if (body.includes('fail')) {
      res.writeHead(429)
      res.end('secret server detail')
      return
    }
    if (req.url === '/v1/audio/speech') {
      res.end(Buffer.from('ID3fixture'))
      return
    }
    res.setHeader('content-type', 'application/json')
    if (req.url?.endsWith(':predict')) {
      res.end(JSON.stringify({ predictions: [{ bytesBase64Encoded: png.toString('base64') }] }))
      return
    }
    if (req.url?.includes(':generateContent')) {
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }]
              }
            }
          ]
        })
      )
      return
    }
    if (req.url === '/v1/image_generation') {
      res.end(
        JSON.stringify({
          base_resp: { status_code: 0 },
          data: { image_base64: [png.toString('base64')] }
        })
      )
      return
    }
    res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const dir = await mkdtemp(join(tmpdir(), 'media-test-'))
  try {
    const assets = await BinaryAssetStore.open(dir)
    const model = {
      id: 'model',
      version: 1,
      displayName: 'Image',
      providerProfileId: 'provider',
      remoteModelId: 'gpt-image-1',
      capabilities: {
        modalities: ['image' as const],
        supportsTools: false,
        supportsStructuredOutput: false
      }
    }
    let secret = 'first'
    const services = createMediaServices({
      assets,
      resolveSecret: () => secret,
      catalog: {
        models: { listActive: () => [model], getActive: () => model },
        providers: {
          getActive: () => ({
            id: 'provider',
            version: 1,
            protocol: 'openai-completions',
            secretRef: 'key',
            baseUrl: `http://127.0.0.1:${address.port}/v1`
          })
        }
      }
    })
    const request = (operation: string, prompt = 'draw'): CreativeRequest => ({
      projectId: 'project',
      operation,
      params: { modelProfileId: 'model', prompt },
      inputAssets: [],
      componentId: 'image',
      componentVersion: '1',
      idempotencyKey: 'test'
    })
    const r = request('image.generate')
    r.params.background = 'transparent'
    const handler = services.handlers(r)!
    secret = 'second'
    model.remoteModelId = 'dall-e-3'
    const emitted: unknown[] = []
    const context = {
      signal: new AbortController().signal,
      emit: async (_type: string, data: unknown) => {
        emitted.push(data)
      }
    }
    handler.validate(r)
    await handler.run(r, context)
    expect(calls[0]?.auth).toBe('Bearer first')
    expect(JSON.parse(calls[0]!.body).model).toBe('gpt-image-1')
    expect(JSON.parse(calls[0]!.body).background).toBe('transparent')
    expect(emitted).toHaveLength(2)
    model.remoteModelId = 'tts-1'
    const unsupported = request('speech.generate')
    unsupported.params.instructions = 'whisper'
    expect(() => services.handlers(unsupported)).toThrow('instructions unsupported')
    const speech = request('speech.generate')
    await services.handlers(speech)!.run(speech, context)
    expect(calls[1]?.path).toBe('/v1/audio/speech')
    expect(JSON.parse(calls[1]!.body).voice).toBe('alloy')
    const fail = request('speech.generate', 'fail')
    await expect(services.handlers(fail)!.run(fail, context)).rejects.toThrow(
      'Media generation failed'
    )
    expect(calls).toHaveLength(3)
    for (const [remoteModelId, protocol, path] of [
      ['grok-imagine-image', 'openai-completions', '/v1/images/generations'],
      ['image-01', 'openai-completions', '/v1/image_generation'],
      [
        'gemini-2.5-flash-image',
        'google-generative-ai',
        '/v1beta/models/gemini-2.5-flash-image:generateContent'
      ],
      [
        'imagen-4.0-generate-001',
        'google-generative-ai',
        '/v1beta/models/imagen-4.0-generate-001:predict'
      ]
    ] as const) {
      model.remoteModelId = remoteModelId
      const nativeServices = createMediaServices({
        assets,
        resolveSecret: () => 'native',
        catalog: {
          models: { listActive: () => [model], getActive: () => model },
          providers: {
            getActive: () => ({
              id: 'provider',
              version: 1,
              protocol,
              secretRef: 'key',
              baseUrl: `http://127.0.0.1:${address.port}/v1`
            })
          }
        }
      })
      const native = request('image.generate')
      await nativeServices.handlers(native)!.run(native, context)
      if (remoteModelId.startsWith('imagen-'))
        expect(() => nativeServices.handlers(request('image.edit'))).toThrow(
          'Unsupported media model'
        )
      expect(calls.at(-1)?.path).toBe(path)
      expect(JSON.parse(calls.at(-1)!.body)).toBeTruthy()
    }
    model.remoteModelId = 'gpt-image-1'
    const batch = request('image.generate')
    batch.params.count = 3
    await services.handlers(batch)!.run(batch, context)
    expect(calls.slice(-3).every((c) => JSON.parse(c.body).n === 1)).toBe(true)
    const partial = request('image.generate', 'partial')
    partial.params.count = 2
    const partialResult = (await services.handlers(partial)!.run(partial, context)) as {
      partial: boolean
      assets: unknown[]
      errors: unknown[]
    }
    expect(partialResult.partial).toBe(true)
    expect(partialResult.assets).toHaveLength(1)
    expect(partialResult.errors).toHaveLength(1)
    const invalid = request('image.generate', 'invalid-output')
    await expect(services.handlers(invalid)!.run(invalid, context)).rejects.toThrow()
    const missing = createMediaServices({
      assets,
      resolveSecret: () => undefined,
      catalog: {
        models: { listActive: () => [model], getActive: () => model },
        providers: {
          getActive: () => ({
            id: 'provider',
            version: 1,
            protocol: 'openai-completions',
            secretRef: 'missing'
          })
        }
      }
    })
    expect(() => missing.handlers(batch)).toThrow('credential unavailable')
    const before = calls.length
    const controller = new AbortController()
    controller.abort()
    await expect(
      services.handlers(batch)!.run(batch, { ...context, signal: controller.signal })
    ).rejects.toThrow()
    expect(calls).toHaveLength(before)
    const source = await assets.import(
      (async function* () {
        yield png
      })(),
      { mime: 'image/png', filename: 'source.png' }
    )
    const edit = request('image.edit')
    edit.inputAssets = [source]
    await services.handlers(edit)!.run(edit, context)
    expect(calls.at(-1)?.path).toBe('/v1/images/edits')
    expect(calls.at(-1)?.body).toContain('name="image"')
    edit.params.maskAssetId = source.id
    const countBeforeMask = calls.length
    await expect(services.handlers(edit)!.run(edit, context)).rejects.toThrow()
    expect(calls).toHaveLength(countBeforeMask)
    const realFetch = fetch
    const downloads = createMediaServices({
      assets,
      resolveSecret: () => 'hidden',
      catalog: {
        models: { listActive: () => [model], getActive: () => model },
        providers: {
          getActive: () => ({
            id: 'provider',
            version: 1,
            protocol: 'openai-completions',
            secretRef: 'key',
            baseUrl: `http://127.0.0.1:${address.port}/v1`
          })
        }
      },
      fetch: async (input, init) => {
        if (String(input).startsWith('https://results.example/')) {
          return new Response(png)
        }
        await realFetch(input, init)
        return Response.json({ data: [{ url: 'https://127.0.0.1/result.png' }] })
      }
    })
    await expect(downloads.handlers(r)!.run(r, context)).rejects.toThrow()
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})
