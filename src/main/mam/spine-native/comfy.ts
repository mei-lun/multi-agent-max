import type { BinaryAssetStore } from '../creative-runtime/assets'
import type { CreativeRequest } from '../../../shared/mam/creative-runtime'
import type { OperationHandler } from '../creative-runtime/jobs'
import {
  spineComfySchema,
  spinePayloads,
  spineSettingsSchema
} from '../../../shared/mam/spine-native'
import { spineGraph } from './graph'
import type { SpineReceipts } from './receipts'
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
export function comfyEndpoint(endpoint: string) {
  const url = new URL(endpoint)
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('ComfyUI requires loopback HTTP')
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1'
  return url.origin
}
export async function bounded(response: Response, limit: number) {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit)
    throw new Error('Invalid bounded local response')
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of response.body) {
    total += chunk.length
    if (total > limit) throw new Error('Local response size exceeded')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
export function comfyHandler(
  request: CreativeRequest,
  options: {
    assets: BinaryAssetStore
    validateImage: (bytes: Buffer) => string
    receipts: SpineReceipts
    fetcher: typeof fetch
  }
): OperationHandler {
  const params = spineComfySchema.parse(request.params),
    endpoint = comfyEndpoint(params.endpoint)
  const payload = spinePayloads[params.operation].parse(params.payload)
  const id = 'jobId' in payload ? String(payload.jobId) : undefined
  if (
    params.operation === 'upload'
      ? request.inputAssets.length !== 1
      : request.inputAssets.length !== 0
  )
    throw new Error('Invalid ComfyUI asset inputs')
  if (params.operation === 'upload' && request.inputAssets[0]!.bytes > 16 * 1024 * 1024)
    throw new Error('ComfyUI input too large')
  return {
    validate() {},
    async run(_accepted, context) {
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(45000)])
      const call = async (path: string, init: RequestInit = {}) =>
        options.fetcher(new URL(path, endpoint + '/'), { ...init, signal, redirect: 'error' })
      const json = async (path: string, init?: RequestInit) =>
        JSON.parse((await bounded(await call(path, init), 8 * 1024 * 1024)).toString()) as unknown
      let receipt = id ? await options.receipts.get(request, endpoint, id) : undefined
      if (params.operation === 'info') return json('object_info')
      if (params.operation === 'upload') {
        if (receipt?.submitted) throw new Error('Existing ComfyUI job cannot upload or resubmit')
        const bytes = await options.assets.read(request.inputAssets[0]!)
        if (options.validateImage(bytes) !== 'image/png') throw new Error('ComfyUI requires PNG')
        const form = new FormData()
        form.set(
          'image',
          new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
          `levelup_spine_input_${id}.png`
        )
        form.set('type', 'input')
        form.set('overwrite', 'false')
        receipt = {
          jobId: id!,
          endpoint,
          projectId: request.projectId,
          componentId: request.componentId
        }
        await options.receipts.put(request, endpoint, receipt)
        const result = await json('upload/image', { method: 'POST', body: form })
        if (
          object(result).name !== `levelup_spine_input_${id}.png` ||
          (object(result).subfolder && object(result).subfolder !== '') ||
          (object(result).type && object(result).type !== 'input')
        )
          throw new Error('Invalid upload receipt')
        return result
      }
      if (params.operation === 'history') {
        const promptId = String('promptId' in payload ? payload.promptId : '')
        if (!(await options.receipts.prompt(request, endpoint, promptId)))
          throw new Error('Foreign ComfyUI receipt')
        return json(`history/${promptId}`)
      }
      if (!receipt) throw new Error('Foreign ComfyUI job')
      if (params.operation === 'submit') {
        if (receipt.submitted) throw new Error('Do not resubmit uncertain ComfyUI jobs')
        const config = spineSettingsSchema.parse('config' in payload ? payload.config : undefined)
        if (config.endpoint && comfyEndpoint(config.endpoint) !== endpoint)
          throw new Error('ComfyUI endpoint changed')
        receipt.submitted = true
        await options.receipts.put(request, endpoint, receipt)
        const result = await json('prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: spineGraph(id!, config), client_id: id })
        })
        const promptId = object(result).prompt_id
        if (typeof promptId !== 'string' || !/^[-\w]{1,100}$/.test(promptId))
          throw new Error('Missing ComfyUI receipt; recover without resubmit')
        receipt.promptId = promptId
        await options.receipts.put(request, endpoint, receipt)
        return result
      }
      if (params.operation === 'recover') {
        const found = new Set<string>()
        const inspect = (value: unknown) => {
          if (!Array.isArray(value)) return
          const node = object(object(value[2])['7'])
          if (
            node.class_type === 'LevelUpSpineExport' &&
            object(node.inputs).job_id === id &&
            typeof value[1] === 'string' &&
            /^[-\w]{1,100}$/.test(value[1])
          )
            found.add(value[1])
        }
        for (let attempt = 0; attempt < 2; attempt++) {
          for (const value of Object.values(object(await json('history?max_items=100'))))
            inspect(object(value).prompt)
          if (!attempt) {
            const queue = object(await json('queue'))
            for (const key of ['queue_running', 'queue_pending'])
              for (const value of Array.isArray(queue[key]) ? queue[key] : []) inspect(value)
          }
          if (found.size) break
        }
        if (found.size > 1) throw new Error('Ambiguous ComfyUI receipt')
        const promptId = [...found][0]
        if (promptId) {
          receipt.promptId = promptId
          await options.receipts.put(request, endpoint, receipt)
        }
        return { promptId: promptId ?? null }
      }
      const filename = String('filename' in payload ? payload.filename : '')
      if (!receipt.promptId || !new RegExp(`^levelup_spine_${id}_[0-9]{3}\\.png$`).test(filename))
        throw new Error('Invalid owned ComfyUI image')
      const bytes = await bounded(
        await call(`view?${new URLSearchParams({ filename, type: 'output', subfolder: '' })}`),
        16 * 1024 * 1024
      )
      if (options.validateImage(bytes) !== 'image/png') throw new Error('Invalid ComfyUI PNG')
      const assetRef = await options.assets.import(
        (async function* () {
          yield bytes
        })(),
        { filename, mime: 'image/png' }
      )
      await context.emit('asset', assetRef)
      return { assetRef }
    }
  }
}
