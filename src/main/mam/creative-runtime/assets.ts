import { createHash, randomUUID } from 'node:crypto'
import { open, link, unlink, writeFile, readdir } from 'node:fs/promises'
import { join, basename, resolve } from 'node:path'
import type { AssetRef } from '../../../shared/mam/creative-runtime'
import { assetRefSchema } from '../../../shared/mam/creative-runtime'
import { atomicJson, readSafe, safeDirectory } from './storage'

export class BinaryAssetStore {
  private constructor(
    private directory: string,
    private maxBytes: number
  ) {}
  static async open(
    directory: string,
    options: { maxBytes?: number } = {}
  ): Promise<BinaryAssetStore> {
    const root = await safeDirectory(directory)
    for (const file of await readdir(root))
      if (/^[a-f0-9-]{36}\.tmp$/.test(file)) await unlink(join(root, file))
    const limit = options.maxBytes ?? 512 * 1024 * 1024
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid asset size limit')
    return new BinaryAssetStore(root, limit)
  }
  async import(
    source: AsyncIterable<Uint8Array>,
    metadata: { mime: string; filename: string }
  ): Promise<AssetRef> {
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(metadata.mime)) throw new Error('Invalid MIME')
    const filename =
      basename(metadata.filename)
        .replace(/[^\w. -]/g, '_')
        .slice(0, 160) || 'asset'
    const temporary = join(this.directory, `${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    const hash = createHash('sha256')
    let bytes = 0
    try {
      for await (const chunk of source) {
        bytes += chunk.byteLength
        if (bytes > this.maxBytes) throw new Error('Asset size limit exceeded')
        hash.update(chunk)
        await handle.writeFile(chunk)
      }
      await handle.sync()
    } catch (error) {
      await handle.close()
      await unlink(temporary)
      throw error
    }
    await handle.close()
    const sha256 = hash.digest('hex')
    const blob = join(this.directory, `${sha256}.blob`)
    try {
      await link(temporary, blob)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    } finally {
      await unlink(temporary)
    }
    const ref: AssetRef = assetRefSchema.parse({
      id: randomUUID(),
      sha256,
      bytes,
      mime: metadata.mime,
      filename
    })
    await this.verify(blob, ref)
    await atomicJson(join(this.directory, `${ref.id}.json`), ref)
    return ref
  }
  private async verify(path: string, ref: AssetRef): Promise<Buffer> {
    const bytes = await readSafe(path)
    if (
      bytes.length !== ref.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== ref.sha256
    )
      throw new Error('Asset integrity mismatch')
    return bytes
  }
  async read(ref: AssetRef): Promise<Buffer> {
    ref = assetRefSchema.parse(ref)
    if (!/^[a-f0-9-]{36}$/.test(ref.id) || !/^[a-f0-9]{64}$/.test(ref.sha256))
      throw new Error('Invalid asset reference')
    const saved = assetRefSchema.parse(
      JSON.parse((await readSafe(join(this.directory, `${ref.id}.json`))).toString())
    )
    if (JSON.stringify(saved) !== JSON.stringify(ref)) throw new Error('Asset reference mismatch')
    return this.verify(join(this.directory, `${ref.sha256}.blob`), ref)
  }
  async export(ref: AssetRef, destination: string): Promise<void> {
    const target = resolve(destination)
    if (target.startsWith(this.directory + '/') || target.startsWith(this.directory + '\\'))
      throw new Error('Cannot export into asset storage')
    await writeFile(target, await this.read(ref), { flag: 'wx' })
  }
  async bundle(
    refs: AssetRef[],
    source: { componentId: string; componentVersion: string; references: string[] }
  ) {
    for (const ref of refs) await this.read(ref)
    return { version: 1 as const, source, assets: structuredClone(refs) }
  }
}
