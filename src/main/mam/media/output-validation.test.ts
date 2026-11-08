import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from 'vitest'
import { createMediaServices } from './index'
import { BinaryAssetStore } from '../creative-runtime/assets'
import type { CreativeRequest } from '../../../shared/mam/creative-runtime'

test('decoded MIME determines filename and injected decoder rejects corrupt outputs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'media-mime-'))
  try {
    const assets = await BinaryAssetStore.open(directory)
    const jpeg = Buffer.from([
      255, 216, 255, 192, 0, 17, 8, 0, 1, 0, 1, 3, 1, 0, 2, 0, 3, 0, 255, 217
    ])
    const catalog = {
      models: {
        listActive: () => [],
        getActive: () => ({
          id: 'm',
          version: 1,
          displayName: 'image',
          providerProfileId: 'p',
          remoteModelId: 'gpt-image-1',
          capabilities: {
            modalities: ['image' as const],
            supportsTools: false,
            supportsStructuredOutput: false
          }
        })
      },
      providers: {
        getActive: () => ({ id: 'p', version: 1, protocol: 'openai-completions' as const })
      }
    }
    const request: CreativeRequest = {
      projectId: 'project',
      componentId: 'image',
      componentVersion: '1',
      idempotencyKey: 'one',
      operation: 'image.generate',
      params: { modelProfileId: 'm', prompt: 'test' },
      inputAssets: []
    }
    const context = { signal: new AbortController().signal, emit: async () => {} }
    const options = {
      assets,
      catalog,
      resolveSecret: () => undefined,
      fetch: async () => Response.json({ data: [{ b64_json: jpeg.toString('base64') }] })
    }
    const services = createMediaServices({ ...options, validateImage: () => 'image/jpeg' })
    const result = (await services.handlers(request)!.run(request, context)) as {
      assets: { mime: string; filename: string }[]
    }
    expect(result.assets[0]).toMatchObject({ mime: 'image/jpeg', filename: 'generated.jpg' })
    const rejecting = createMediaServices({
      ...options,
      validateImage: () => {
        throw new Error('Cannot decode image')
      }
    })
    await expect(rejecting.handlers(request)!.run(request, context)).rejects.toThrow()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
