import { test, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BinaryAssetStore } from '../creative-runtime/assets'
import { createVideoHandler } from './video'
import { videoMime } from './video-protocol'
test.each([
  ['grok-imagine-video', 'image'],
  ['grok-imagine-video', 'reference'],
  ['grok-imagine-video', 'video'],
  ['MiniMax-H3', 'first_last'],
  ['MiniMax-H3', 'reference']
])('%s %s request uses exact supported reference body', async (modelId, mode) => {
  const root = await mkdtemp(join(tmpdir(), 'video-mode-'))
  try {
    const assets = await BinaryAssetStore.open(root),
      refs = [],
      mp4 = Buffer.alloc(41)
    mp4.writeUInt32BE(24)
    mp4.write('ftyp', 4)
    mp4.write('isom', 8)
    mp4.writeUInt32BE(8, 24)
    mp4.write('moov', 28)
    mp4.writeUInt32BE(9, 32)
    mp4.write('mdat', 36)
    for (let i = 0; i < (mode === 'first_last' ? 2 : 1); i++)
      refs.push(
        await assets.import(
          (async function* () {
            yield mode === 'video' ? mp4 : Buffer.from('image')
          })(),
          {
            filename: mode === 'video' ? 'input.mp4' : 'image.png',
            mime: mode === 'video' ? 'video/mp4' : 'image/png'
          }
        )
      )
    let body: Record<string, unknown> = {},
      posts = 0,
      receipt = false
    const request = {
      componentId: 'c',
      componentVersion: '1',
      projectId: 'p',
      operation: mode === 'video' ? 'video.edit' : 'video.generate',
      params: { modelProfileId: 'm', prompt: 'scene', mode },
      inputAssets: refs,
      idempotencyKey: 'k'
    }
    const handler = createVideoHandler({
      request,
      assets,
      model: {
        id: 'm',
        version: 1,
        displayName: modelId,
        providerProfileId: 'p',
        remoteModelId: modelId,
        capabilities: {
          modalities: ['text'],
          supportsTools: false,
          supportsStructuredOutput: false
        }
      },
      provider: {
        id: 'p',
        version: 1,
        protocol: 'openai-completions',
        baseUrl: 'http://fixture/v1'
      },
      secret: undefined,
      validateImage: () => 'image/png',
      fetcher: async (url, init) => {
        if (init?.method === 'POST') {
          posts++
          body = JSON.parse(String(init.body))
          return new Response('{"id":"task"}')
        }
        expect(receipt).toBe(true)
        return new Response(String(url).endsWith('/content') ? mp4 : '{"status":"completed"}')
      }
    })
    await handler.run(request, {
      signal: new AbortController().signal,
      emit: async (_type, value) => {
        if ((value as { type?: string }).type === 'remote_task') receipt = true
      }
    })
    expect(posts).toBe(1)
    expect(
      body[
        modelId.startsWith('Mini')
          ? mode === 'first_last'
            ? 'first_image'
            : 'referenceImages'
          : mode === 'video'
            ? 'video'
            : mode === 'image'
              ? 'image'
              : 'reference_images'
      ]
    ).toBeTruthy()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('invalid MP4 placeholders fail container validation', () => {
  const bytes = Buffer.alloc(24)
  bytes.write('ftyp', 4)
  expect(() => videoMime(bytes)).toThrow()
  bytes.writeUInt32BE(24)
  bytes.write('isom', 8)
  expect(() => videoMime(bytes)).toThrow('Incomplete')
})
