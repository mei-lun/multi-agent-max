import { createReadStream, lstatSync } from 'node:fs'
import { mkdir, open, link, unlink, lstat } from 'node:fs/promises'
import { join, resolve, parse, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { AssetBundleSchema, type AssetBundle } from '../../../shared/mam/domain/binary-artifact'
import { assertAncestors } from '../components/registry/persistence'
import { publishBinaryDirectory } from './binary-directory-transaction'
import { binaryIdentity, rememberBinary, requireVerifiedBinary } from './binary-verification-cache'
export type BinaryInput = { logicalPath: string; mime: string; stream: AsyncIterable<Uint8Array> }
export class BinaryArtifactStorage {
  constructor(private root: string) {}
  verifySync(value: unknown) {
    const bundle = AssetBundleSchema.parse(value)
    for (const file of bundle.files) {
      const target = resolve(this.root, file.sha256)
      let ancestor = parse(target).root
      for (const part of target.slice(ancestor.length).split(sep)) {
        ancestor = join(ancestor, part)
        if (lstatSync(ancestor).isSymbolicLink()) throw new Error('Unsafe binary ancestor')
      }
      requireVerifiedBinary(target, file.bytes)
    }
  }
  async import(files: readonly BinaryInput[], source: AssetBundle['source']): Promise<AssetBundle> {
    // Validate all names before consuming a stream.
    AssetBundleSchema.parse({
      version: 1,
      source,
      files: files.map((f) => ({
        logicalPath: f.logicalPath,
        mime: f.mime,
        bytes: 0,
        sha256: '0'.repeat(64),
        storageRef: `sha256:${'0'.repeat(64)}`
      }))
    })
    await assertAncestors(this.root)
    await mkdir(this.root, { recursive: true })
    const result: AssetBundle['files'] = []
    let total = 0
    for (const input of files) {
      const temporary = join(this.root, `.import-${randomUUID()}`),
        handle = await open(temporary, 'wx', 0o600)
      const hash = createHash('sha256')
      let bytes = 0
      try {
        for await (const chunk of input.stream) {
          bytes += chunk.byteLength
          total += chunk.byteLength
          if (bytes > 2 * 1024 ** 3 || total > 8 * 1024 ** 3)
            throw new Error('Binary artifact exceeds limit')
          hash.update(chunk)
          await handle.writeFile(chunk)
        }
        await handle.sync()
        await handle.close()
        const sha256 = hash.digest('hex'),
          file = {
            logicalPath: input.logicalPath,
            mime: input.mime,
            bytes,
            sha256,
            storageRef: `sha256:${sha256}`
          }
        try {
          await link(temporary, join(this.root, sha256))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        }
        await this.verifyFile(file)
        result.push(file)
      } finally {
        await handle.close().catch(() => {})
        await unlink(temporary)
      }
    }
    return AssetBundleSchema.parse({ version: 1, source, files: result })
  }
  private async verifyFile(file: AssetBundle['files'][number], destination?: string) {
    const path = join(this.root, file.sha256)
    await assertAncestors(path)
    const identity = binaryIdentity(await lstat(path))
    const hash = createHash('sha256')
    let bytes = 0
    const output = destination ? await open(destination, 'wx', 0o600) : undefined
    try {
      for await (const chunk of createReadStream(path)) {
        bytes += chunk.length
        if (bytes > file.bytes) throw new Error('Binary artifact length mismatch')
        hash.update(chunk)
        if (output) await output.writeFile(chunk)
      }
      if (bytes !== file.bytes || hash.digest('hex') !== file.sha256)
        throw new Error('Binary artifact integrity mismatch')
      await rememberBinary(resolve(path), identity)
    } catch (error) {
      if (output) {
        await output.close()
        await unlink(destination!).catch(() => {})
      }
      throw error
    } finally {
      await output?.close().catch(() => {})
    }
  }
  async verify(value: unknown) {
    const bundle = AssetBundleSchema.parse(value)
    for (const file of bundle.files) await this.verifyFile(file)
    return bundle
  }
  async materialize(value: unknown, destination: string) {
    const bundle = await this.verify(value)
    await publishBinaryDirectory(destination, async (stage) => {
      for (const file of bundle.files) {
        const parts = file.logicalPath.split('/'),
          name = parts.pop()!
        const directory = join(stage, ...parts)
        await mkdir(directory, { recursive: true })
        await assertAncestors(directory)
        await this.verifyFile(file, join(directory, name))
      }
    })
  }
}
