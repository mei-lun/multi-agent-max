import { test, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { BinaryAssetStore } from '../creative-runtime/assets'
import { createVideoHandler, type VideoReceipt } from './video'
import type { ProviderProtocol } from '../../../shared/mam/domain/execution-profile'
const mp4 = () => {
  const bytes = Buffer.alloc(41)
  bytes.writeUInt32BE(24)
  bytes.write('ftyp', 4)
  bytes.write('isom', 8)
  bytes.writeUInt32BE(8, 24)
  bytes.write('moov', 28)
  bytes.writeUInt32BE(9, 32)
  bytes.write('mdat', 36)
  return bytes
}
test.each([
  'Grok-imagine-video',
  'sora-2',
  'MiniMax-H3',
  'MiniMax-H3-direct',
  'Seedance-2',
  'veo-3'
])('%s create receipt poll download refresh GET-only', async (modelId) => {
  const directory = await mkdtemp(join(tmpdir(), 'video-route-')),
    calls: string[] = [],
    bodies: unknown[] = []
  let receipt: VideoReceipt | undefined
  const veo = modelId === 'veo-3',
    seed = modelId === 'Seedance-2',
    mini = modelId.startsWith('MiniMax-H3'),
    direct = modelId.endsWith('-direct')
  const remote = veo ? 'models/veo-3/operations/task-one' : 'task-one'
  let origin = ''
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    calls.push(`${req.method} ${req.url}`)
    expect(req.headers[veo ? 'x-goog-api-key' : 'authorization']).toBe(
      veo ? 'secret' : 'Bearer secret'
    )
    if (req.url === '/v1/media/references') {
      res.end(JSON.stringify({ url: `https://public.example/reference-${calls.length}` }))
      return
    }
    if (req.method === 'POST') {
      bodies.push(JSON.parse(Buffer.concat(chunks).toString()))
      res.end(JSON.stringify(veo ? { name: remote } : { task_id: remote }))
      return
    }
    expect(receipt).toBeTruthy()
    if (req.url?.endsWith('/content')) {
      res.end(mp4())
      return
    }
    res.end(
      JSON.stringify(
        veo
          ? { done: true, response: { videoUri: origin + '/video/content' } }
          : mini
            ? {
                task: {
                  status: 'succeeded',
                  content: {
                    url: direct ? 'https://api.minimax.io/video/content' : origin + '/video/content'
                  }
                }
              }
            : { status: 'completed' }
      )
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    const assets = await BinaryAssetStore.open(directory),
      refs = []
    if (seed)
      for (const name of ['first', 'last'])
        refs.push(
          await assets.import(
            (async function* () {
              yield Buffer.from(name)
            })(),
            { filename: name + '.png', mime: 'image/png' }
          )
        )
    const request = {
      componentId: 'v',
      componentVersion: '1',
      projectId: 'p',
      operation: 'video.generate',
      idempotencyKey: 'k',
      params: { modelProfileId: 'm', prompt: 'scene', mode: seed ? 'first_last' : 'text' },
      inputAssets: refs
    }
    const options = {
      request,
      assets,
      model: {
        id: 'm',
        version: 1,
        displayName: modelId,
        providerProfileId: 'p',
        remoteModelId: direct ? 'MiniMax-H3' : modelId,
        capabilities: {
          modalities: ['text'] as ['text'],
          supportsTools: false,
          supportsStructuredOutput: false
        }
      },
      provider: {
        id: 'p',
        version: 1,
        protocol: (veo ? 'google-generative-ai' : 'openai-completions') as ProviderProtocol,
        baseUrl: direct ? 'https://api.minimax.io/v1' : origin + '/v1',
        secretRef: 'key'
      },
      secret: 'secret',
      fetcher: ((url, init) => {
        const target = new URL(String(url))
        return fetch(direct ? new URL(target.pathname + target.search, origin) : url, init)
      }) as typeof fetch,
      validateImage: () => 'image/png'
    }
    const context = {
      signal: new AbortController().signal,
      emit: async (_type: string, data: unknown) => {
        if ((data as { type?: string }).type === 'remote_task') receipt = data as VideoReceipt
      }
    }
    const result = (await createVideoHandler(options).run(request, context)) as {
      assets: { mime: string; filename: string }[]
    }
    expect(result.assets[0]).toMatchObject({ mime: 'video/mp4', filename: 'generated.mp4' })
    if (seed) {
      expect(bodies[0]).toMatchObject({
        first_image: 'https://public.example/reference-1',
        last_image: 'https://public.example/reference-2'
      })
      expect(calls.filter((call) => call.includes('references'))).toHaveLength(2)
    }
    if (direct) {
      expect(calls).toContain('POST /v2/video_generation')
      expect(calls).toContain('GET /v2/query/video_generation/task-one')
      expect(bodies[0]).toMatchObject({
        resolution: '768P',
        content: [{ type: 'text', text: 'scene' }]
      })
    }
    const before = calls.filter((call) => call.startsWith('POST')).length
    await createVideoHandler({ ...options, receipt: receipt! }).run(request, context)
    expect(calls.filter((call) => call.startsWith('POST'))).toHaveLength(before)
    const controller = new AbortController()
    controller.abort()
    await expect(
      createVideoHandler({ ...options, receipt: { ...receipt!, remoteId: '../bad' } }).run(
        request,
        context
      )
    ).rejects.toThrow('requires reconciliation')
    await expect(
      createVideoHandler({ ...options, receipt: receipt! }).run(request, {
        ...context,
        signal: controller.signal
      })
    ).rejects.toThrow()
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})
