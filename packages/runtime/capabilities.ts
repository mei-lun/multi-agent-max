import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { BinaryAssetStore } from '../../src/main/mam/creative-runtime/assets'

export const invocation = new AsyncLocalStorage<string>()
const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>()
process.on('message', (raw: { type: string; call: string; value: unknown; error?: string }) => {
  if (raw.type !== 'reply') return
  const call = pending.get(raw.call)
  pending.delete(raw.call)
  if (raw.error) call?.reject(new Error(raw.error))
  else call?.resolve(raw.value)
})
export function rpc(method: string, value?: unknown): Promise<unknown> {
  const id = invocation.getStore()
  if (!id || pending.size > 128) throw new Error('No active package capability context')
  return new Promise((resolve, reject) => {
    const call = randomUUID()
    pending.set(call, { resolve, reject })
    process.send!({ type: 'rpc', id, call, method, value })
  })
}
export const assets = {
  async read(ref) {
    if (ref.bytes > 512 * 1024 * 1024) throw new Error('Package asset limit')
    const chunks: Buffer[] = []
    for (let offset = 0; offset < ref.bytes; offset += 1024 * 1024) {
      chunks.push(Buffer.from((await rpc('asset.read', { ref, offset })) as string, 'base64'))
    }
    return Buffer.concat(chunks)
  },
  async import(source, metadata) {
    const token = await rpc('asset.begin', { metadata })
    let bytes = 0
    for await (const chunk of source) {
      bytes += chunk.byteLength
      if (bytes > 512 * 1024 * 1024) throw new Error('Package asset limit')
      for (let offset = 0; offset < chunk.length; offset += 1024 * 1024) {
        await rpc('asset.chunk', {
          token,
          bytes: Buffer.from(chunk.subarray(offset, offset + 1024 * 1024)).toString('base64')
        })
      }
    }
    return rpc('asset.finish', { token })
  }
} as BinaryAssetStore
export const dialog = { showOpenDialog: () => rpc('dialog.directory') }
