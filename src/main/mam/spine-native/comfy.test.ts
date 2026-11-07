import { expect, test } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BinaryAssetStore } from '../creative-runtime/assets'
import { createSpineNativeServices } from './index'
const id = 'a'.repeat(32)
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=',
  'base64'
)
test('real loopback Comfy upload fixed graph history recovery and owned image', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'comfy-')),
    assets = await BinaryAssetStore.open(join(directory, 'assets'))
  const ref = await assets.import(
    (async function* () {
      yield png
    })(),
    { filename: 'source.png', mime: 'image/png' }
  )
  let graph: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {},
    posts = 0
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    res.setHeader('content-type', 'application/json')
    if (req.url === '/object_info') return res.end('{}')
    if (req.url === '/upload/image') {
      expect(Buffer.concat(chunks).includes(png)).toBe(true)
      return res.end(
        JSON.stringify({ name: `levelup_spine_input_${id}.png`, type: 'input', subfolder: '' })
      )
    }
    if (req.url === '/prompt') {
      posts++
      graph = JSON.parse(Buffer.concat(chunks).toString()).prompt
      return res.end('{"prompt_id":"receipt"}')
    }
    if (req.url?.startsWith('/history'))
      return res.end(
        JSON.stringify({
          receipt: { prompt: [1, 'receipt', graph, {}, []], status: { completed: true } }
        })
      )
    if (req.url === '/queue') return res.end('{"queue_running":[],"queue_pending":[]}')
    if (req.url?.startsWith('/view?')) return res.end(png)
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const opts = {
    assets,
    validateImage: () => 'image/png',
    receiptDirectory: join(directory, 'receipts')
  }
  let service = createSpineNativeServices(opts)
  const call = async (
    operation: string,
    payload: Record<string, unknown>,
    inputAssets: (typeof ref)[] = [],
    projectId = 'p'
  ) => {
    const request = {
      componentId: 'creative.spine',
      componentVersion: '1',
      projectId,
      operation: 'spine.comfy.request',
      params: { endpoint, operation, payload },
      inputAssets,
      idempotencyKey: 'k'
    }
    return service
      .handlers(request)!
      .run(request, { signal: new AbortController().signal, emit: async () => {} })
  }
  try {
    await call('info', {})
    await call('upload', { jobId: id }, [ref])
    await call('submit', {
      jobId: id,
      config: {
        layerModel: 'layer',
        depthModel: 'depth',
        resolution: 512,
        steps: 20,
        seed: 1,
        quant: 'none',
        groupOffload: false
      }
    })
    expect(graph['2']!.inputs.auto_download).toBe(false)
    expect(Object.keys(graph)).toHaveLength(7)
    service = createSpineNativeServices(opts)
    expect(await call('recover', { jobId: id })).toEqual({ promptId: 'receipt' })
    await call('history', { promptId: 'receipt' })
    const result = (await call('image', {
      jobId: id,
      filename: `levelup_spine_${id}_000.png`
    })) as { assetRef: typeof ref }
    expect(await assets.read(result.assetRef)).toEqual(png)
    await expect(call('history', { promptId: 'receipt' }, [], 'foreign')).rejects.toThrow(
      'Spine native operation failed'
    )
    await expect(call('image', { jobId: id, filename: '../secret' })).rejects.toThrow(
      'Spine native operation failed'
    )
    await expect(
      call('submit', {
        jobId: id,
        config: {
          layerModel: 'layer',
          depthModel: 'depth',
          resolution: 512,
          steps: 20,
          seed: 1,
          quant: 'none',
          groupOffload: false
        }
      })
    ).rejects.toThrow('Spine native operation failed')
    expect(posts).toBe(1)
    expect(() =>
      service.handlers({
        componentId: 'c',
        componentVersion: '1',
        projectId: 'p',
        operation: 'spine.comfy.request',
        inputAssets: [],
        idempotencyKey: 'k',
        params: { endpoint: 'https://remote.example', operation: 'info', payload: {} }
      })
    ).toThrow('loopback')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})
