import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect } from 'vitest'
import { createMediaServices, type VideoReceipt } from './index'
import { BinaryAssetStore } from '../creative-runtime/assets'
import type { CreativeRequest } from '../../../shared/mam/creative-runtime'
test('video receipt persists before polling and recovery never resubmits', async () => {
  const calls: string[] = []
  let receipt: VideoReceipt | undefined
  const mp4 = Buffer.alloc(41)
  mp4.writeUInt32BE(24, 0)
  mp4.write('ftyp', 4)
  mp4.write('isom', 8)
  mp4.writeUInt32BE(8, 24)
  mp4.write('moov', 28)
  mp4.writeUInt32BE(9, 32)
  mp4.write('mdat', 36)
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
    }
    calls.push(`${req.method} ${req.url}`)
    if (req.method === 'POST') {
      res.end('{"id":"remote_one"}')
      return
    }
    expect(receipt).toBeTruthy()
    res.end(req.url?.endsWith('/content') ? mp4 : '{"status":"completed"}')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  const directory = await mkdtemp(join(tmpdir(), 'video-'))
  try {
    const assets = await BinaryAssetStore.open(directory)
    const model = {
      id: 'm',
      version: 1,
      displayName: 'Grok video',
      providerProfileId: 'p',
      remoteModelId: 'grok-imagine-video',
      capabilities: {
        modalities: ['image' as const],
        supportsTools: false,
        supportsStructuredOutput: false
      }
    }
    const services = createMediaServices({
      assets,
      resolveSecret: () => 'fixture',
      resolveVideoReceipt: () => receipt,
      catalog: {
        models: { listActive: () => [model], getActive: () => model },
        providers: {
          getActive: () => ({
            id: 'p',
            version: 1,
            protocol: 'openai-completions',
            baseUrl: `http://127.0.0.1:${port}/v1`,
            secretRef: 'key'
          })
        }
      }
    })
    const request: CreativeRequest = {
      projectId: 'p',
      componentId: 'v',
      componentVersion: '1',
      idempotencyKey: 'one',
      operation: 'video.generate',
      params: { modelProfileId: 'm', prompt: 'film', mode: 'text' },
      inputAssets: []
    }
    const context = {
      signal: new AbortController().signal,
      emit: async (_type: string, data: unknown) => {
        if ((data as { type?: string }).type === 'remote_task') receipt = data as VideoReceipt
      }
    }
    await services.handlers(request)!.run(request, context)
    expect(calls).toEqual([
      'POST /v1/videos/generations',
      'GET /v1/videos/remote_one',
      'GET /v1/videos/remote_one/content'
    ])
    request.operation = 'video.refresh'
    request.params = { sourceJobId: 'original' }
    await services.handlers(request)!.run(request, context)
    expect(calls.filter((c) => c.startsWith('POST'))).toHaveLength(1)
  } finally {
    server.close()
    await rm(directory, { recursive: true, force: true })
  }
})
