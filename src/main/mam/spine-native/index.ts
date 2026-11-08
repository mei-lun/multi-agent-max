import type { BinaryAssetStore } from '../creative-runtime/assets'
import type { HandlerRegistry } from '../creative-runtime/jobs'
import { SpineReceipts } from './receipts'
import { comfyHandler } from './comfy'
import { rifeHandler, type RifeConfig } from './rife'
export function createSpineNativeServices(options: {
  assets: BinaryAssetStore
  validateImage: (bytes: Buffer) => string
  receiptDirectory: string
  fetch?: typeof fetch
  rife?: RifeConfig
}) {
  const receipts = new SpineReceipts(options.receiptDirectory)
  let queue: Promise<unknown> = Promise.resolve()
  const handlers: HandlerRegistry = (request) => {
    const handler =
      request.operation === 'spine.comfy.request'
        ? comfyHandler(structuredClone(request), {
            ...options,
            receipts,
            fetcher: options.fetch ?? fetch
          })
        : request.operation === 'spine.rife.frame' && options.rife
          ? rifeHandler(structuredClone(request), { ...options, config: options.rife })
          : undefined
    if (!handler) return
    return {
      ...handler,
      run: (accepted, context) => {
        const result = queue.then(async () => {
          context.signal.throwIfAborted()
          try {
            return await handler.run(accepted, context)
          } catch {
            throw new Error(
              context.signal.aborted
                ? 'Spine native operation cancelled'
                : 'Spine native operation failed'
            )
          }
        })
        queue = result.catch(() => {})
        return result
      }
    }
  }
  return { handlers, capabilities: { comfy: true, rife: !!options.rife } }
}
