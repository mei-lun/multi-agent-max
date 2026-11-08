import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from 'vitest'
import { createMediaServices } from './index'
import { BinaryAssetStore } from '../creative-runtime/assets'
import { geminiSpeechBytes } from './speech'
import type { CreativeRequest } from '../../../shared/mam/creative-runtime'

test('Gemini and Grok native speech HTTP bodies, WAV bytes and errors', async () => {
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const envelope = JSON.stringify({
    candidates: [
      {
        content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: 'AAABAA==' } }] }
      }
    ]
  })
  const wav = geminiSpeechBytes(Buffer.from(envelope))
  const server = createServer(async (req, res) => {
    let text = ''
    for await (const part of req) text += part.toString()
    calls.push({ path: req.url!, body: JSON.parse(text) })
    if (text.includes('fail')) {
      res.writeHead(400)
      res.end()
      return
    }
    res.end(req.url === '/v1/tts' ? wav : envelope)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const directory = await mkdtemp(join(tmpdir(), 'speech-'))
  try {
    const assets = await BinaryAssetStore.open(directory)
    for (const [id, protocol] of [
      ['gemini-2.5-flash-preview-tts', 'google-generative-ai'],
      ['grok-voice-tts', 'openai-completions']
    ] as const) {
      const services = createMediaServices({
        assets,
        resolveSecret: () => 'fixture',
        catalog: {
          models: {
            listActive: () => [],
            getActive: () => ({
              id: 'm',
              version: 1,
              displayName: 'Speech',
              providerProfileId: 'p',
              remoteModelId: id,
              capabilities: {
                modalities: ['audio'],
                supportsTools: false,
                supportsStructuredOutput: false
              }
            })
          },
          providers: {
            getActive: () => ({
              id: 'p',
              version: 1,
              protocol,
              secretRef: 'key',
              baseUrl: `http://127.0.0.1:${port}/v1`
            })
          }
        }
      })
      const request: CreativeRequest = {
        projectId: 'project',
        componentId: 'speech',
        componentVersion: '1',
        operation: 'speech.generate',
        idempotencyKey: id,
        params: { modelProfileId: 'm', prompt: 'hello', outputFormat: 'wav' },
        inputAssets: []
      }
      const context = { signal: new AbortController().signal, emit: async () => {} }
      const result = (await services.handlers(request)!.run(request, context)) as {
        assets: Parameters<typeof assets.read>[0][]
      }
      expect(await assets.read(result.assets[0]!)).toEqual(wav)
      expect(calls.at(-1)?.path).toBe(
        protocol === 'google-generative-ai' ? `/v1beta/models/${id}:generateContent` : '/v1/tts'
      )
      if (protocol === 'openai-completions')
        expect(calls.at(-1)?.body).toEqual({
          text: 'hello',
          language: 'auto',
          voice_id: 'eve',
          output_format: { codec: 'wav' }
        })
      request.params.prompt = 'fail'
      await expect(services.handlers(request)!.run(request, context)).rejects.toThrow()
    }
    expect(calls).toHaveLength(4)
  } finally {
    server.close()
    await rm(directory, { recursive: true, force: true })
  }
})
