import { randomUUID } from 'node:crypto'
import type { BinaryAssetStore } from '../creative-runtime/assets'
import { assetRefSchema, type AssetRef } from '../../../shared/mam/creative-runtime'
import { decodeImage } from './host-native-assets'

const chunkLimit = 1024 * 1024
/** Per-invocation grants and bounded chunk transport; package paths never become host paths. */
export function packageAssets(store: BinaryAssetStore, inputs: AssetRef[]) {
  const granted = new Map(inputs.map((ref) => [ref.id, ref]))
  const uploads = new Map<
    string,
    { chunks: Buffer[]; metadata: { mime: string; filename: string } }
  >()
  const reads = new Map<string, Buffer>()
  let imported = 0,
    readBytes = 0
  const check = (value: unknown) => {
    const ref = assetRefSchema.parse(value)
    if (JSON.stringify(granted.get(ref.id)) !== JSON.stringify(ref))
      throw new Error('Package asset access denied')
    return ref
  }
  return {
    check,
    async call(method: string, value: unknown) {
      const input = value as {
        ref: AssetRef
        offset: number
        token: string
        bytes: string
        metadata: { mime: string; filename: string }
      }
      if (method === 'asset.read') {
        const ref = check(input.ref)
        if (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > ref.bytes)
          throw new Error('Invalid asset offset')
        let bytes = reads.get(ref.id)
        if (!bytes) {
          if ((readBytes += ref.bytes) > 512 * 1024 * 1024)
            throw new Error('Package input budget exceeded')
          bytes = await store.read(ref)
          if (ref.mime.startsWith('image/')) decodeImage(bytes)
          reads.set(ref.id, bytes)
        }
        return bytes.subarray(input.offset, input.offset + chunkLimit).toString('base64')
      }
      if (method === 'asset.begin') {
        if (
          uploads.size >= 8 ||
          !input.metadata ||
          typeof input.metadata.mime !== 'string' ||
          typeof input.metadata.filename !== 'string'
        )
          throw new Error('Invalid package upload')
        const token = randomUUID()
        uploads.set(token, { chunks: [], metadata: input.metadata })
        return token
      }
      const upload = uploads.get(input.token)
      if (!upload) throw new Error('Unknown package upload')
      if (method === 'asset.chunk') {
        if (typeof input.bytes !== 'string' || input.bytes.length > 1400000)
          throw new Error('Package asset chunk limit')
        const bytes = Buffer.from(input.bytes, 'base64')
        if (bytes.length > chunkLimit || (imported += bytes.length) > 512 * 1024 * 1024)
          throw new Error('Package output budget exceeded')
        upload.chunks.push(bytes)
        return null
      }
      if (method !== 'asset.finish') throw new Error('Unknown asset capability')
      uploads.delete(input.token)
      if (
        upload.metadata.mime.startsWith('image/') &&
        decodeImage(Buffer.concat(upload.chunks)) !== upload.metadata.mime
      )
        throw new Error('Package image MIME mismatch')
      const ref = await store.import(
        (async function* () {
          yield* upload.chunks
        })(),
        upload.metadata
      )
      granted.set(ref.id, ref)
      return ref
    }
  }
}
