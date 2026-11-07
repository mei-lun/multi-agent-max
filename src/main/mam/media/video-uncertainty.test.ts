import { test, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BinaryAssetStore } from '../creative-runtime/assets'
import { CreativeJobManager } from '../creative-runtime/jobs'
import { createVideoHandler } from './video'
test('unknown POST receipt becomes reconciliation-required without resubmission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'video-uncertain-'))
  let posts = 0
  const assets = await BinaryAssetStore.open(join(root, 'assets'))
  const jobs = await CreativeJobManager.open({
    directory: join(root, 'jobs'),
    handlers: (request) =>
      createVideoHandler({
        request,
        assets,
        model: {
          id: 'm',
          version: 1,
          displayName: 'video',
          providerProfileId: 'p',
          remoteModelId: 'sora-2',
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
          baseUrl: 'https://fixture.example/v1'
        },
        secret: 'private-secret',
        fetcher: async () => {
          posts++
          return new Response('{"id":"../invalid"}')
        }
      })
  })
  try {
    const id = await jobs.submit({
      componentId: 'creative.video',
      componentVersion: '1.0.0',
      projectId: 'p',
      operation: 'video.generate',
      params: { modelProfileId: 'm', prompt: 'scene', mode: 'text' },
      inputAssets: [],
      idempotencyKey: 'k'
    })
    for (let i = 0; i < 100 && jobs.get(id).state !== 'reconciliation-required'; i++)
      await new Promise((resolve) => setTimeout(resolve, 10))
    expect(jobs.get(id).state).toBe('reconciliation-required')
    expect(posts).toBe(1)
    expect(
      jobs
        .get(id)
        .events.some((event) => (event.data as { type?: string })?.type === 'remote_uncertain')
    ).toBe(true)
    expect(JSON.stringify(jobs.get(id))).not.toContain('private-secret')
  } finally {
    await jobs.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('successful JobManager receipt and progress omit secret header and undefined values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'video-uncertain-'))
  const mp4 = Buffer.alloc(41)
  mp4.writeUInt32BE(24)
  mp4.write('ftyp', 4)
  mp4.write('isom', 8)
  mp4.writeUInt32BE(8, 24)
  mp4.write('moov', 28)
  mp4.writeUInt32BE(9, 32)
  mp4.write('mdat', 36)
  let posts = 0
  const assets = await BinaryAssetStore.open(join(root, 'assets'))
  const jobs = await CreativeJobManager.open({
    directory: join(root, 'jobs'),
    handlers: (request) =>
      createVideoHandler({
        request,
        assets,
        model: {
          id: 'm',
          version: 1,
          displayName: 'video',
          providerProfileId: 'p',
          remoteModelId: 'sora-2',
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
          baseUrl: 'https://fixture.example/v1',
          headers: { Authorization: 'private-header' }
        },
        secret: 'private-secret',
        fetcher: async (url, init) => {
          if (init?.method === 'POST') {
            posts++
            return new Response('{"id":"task"}')
          }
          return new Response(String(url).endsWith('/content') ? mp4 : '{"status":"completed"}')
        }
      })
  })
  try {
    const id = await jobs.submit({
      componentId: 'creative.video',
      componentVersion: '1.0.0',
      projectId: 'p',
      operation: 'video.generate',
      params: { modelProfileId: 'm', prompt: 'scene', mode: 'text' },
      inputAssets: [],
      idempotencyKey: 'k'
    })
    for (let i = 0; i < 100 && jobs.get(id).state !== 'succeeded'; i++)
      await new Promise((resolve) => setTimeout(resolve, 10))
    expect(jobs.get(id).state).toBe('succeeded')
    expect(posts).toBe(1)
    expect(
      jobs.get(id).events.some((event) => (event.data as { type?: string })?.type === 'remote_task')
    ).toBe(true)
    expect(JSON.stringify(jobs.get(id))).not.toContain('private-secret')
  } finally {
    await jobs.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
