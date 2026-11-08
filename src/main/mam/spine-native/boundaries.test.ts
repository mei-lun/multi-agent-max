import { expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { BinaryAssetStore } from '../creative-runtime/assets'
import { createSpineNativeServices } from './index'
import { comfyEndpoint } from './comfy'
test.each([
  'https://127.0.0.1:8188',
  'http://remote.example',
  'http://127.0.0.1/a',
  'http://user:secret@127.0.0.1',
  'http://127.0.0.1/?query=secret'
])('rejects forbidden endpoint %s', (endpoint) => {
  expect(() => comfyEndpoint(endpoint)).toThrow()
})
test('local redirects never follow remote targets and failures expose no server payload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'comfy-redirect-'))
  const server = createServer((_req, res) => {
    res.writeHead(302, { Location: 'http://remote.invalid/private-secret' })
    res.end('raw-private-secret')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const service = createSpineNativeServices({
      assets: await BinaryAssetStore.open(join(directory, 'assets')),
      validateImage: () => 'image/png',
      receiptDirectory: join(directory, 'receipts')
    })
    const request = {
      componentId: 'c',
      componentVersion: '1',
      projectId: 'p',
      operation: 'spine.comfy.request',
      inputAssets: [],
      idempotencyKey: 'k',
      params: {
        endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
        operation: 'info',
        payload: {}
      }
    }
    await expect(
      service
        .handlers(request)!
        .run(request, { signal: new AbortController().signal, emit: async () => {} })
    ).rejects.toThrow(/^Spine native operation failed$/)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})
test('cancel before dispatch does not touch local service; arbitrary interrupt operation rejected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'comfy-cancel-'))
  let calls = 0
  try {
    const service = createSpineNativeServices({
      assets: await BinaryAssetStore.open(join(directory, 'assets')),
      validateImage: () => 'image/png',
      receiptDirectory: join(directory, 'receipts'),
      fetch: async () => {
        calls++
        throw Error('unexpected')
      }
    })
    const request = {
      componentId: 'c',
      componentVersion: '1',
      projectId: 'p',
      operation: 'spine.comfy.request',
      inputAssets: [],
      idempotencyKey: 'k',
      params: { endpoint: 'http://127.0.0.1:8188', operation: 'info', payload: {} }
    }
    const controller = new AbortController()
    controller.abort()
    await expect(
      service.handlers(request)!.run(request, { signal: controller.signal, emit: async () => {} })
    ).rejects.toThrow()
    expect(calls).toBe(0)
    expect(() =>
      service.handlers({ ...request, params: { ...request.params, operation: 'interrupt' } })
    ).toThrow()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
