import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ArtifactVersionSchema } from '../../../shared/mam/domain/artifact'
import { BinaryArtifactStorage } from './binary-asset-storage'
import { assertAncestors } from '../components/registry/persistence'
import { createHash } from 'node:crypto'
export async function prepareStoredBinaryArtifacts(root: string) {
  const directory = join(root, 'versions')
  await assertAncestors(directory)
  const artifacts = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const storage = new BinaryArtifactStorage(join(root, 'binary'))
  for (const artifact of artifacts) {
    const path = join(directory, artifact)
    await assertAncestors(path)
    for (const file of await readdir(path)) {
      if (!/^\d+\.json$/.test(file)) continue
      const metadata = join(path, file)
      await assertAncestors(metadata)
      const version = ArtifactVersionSchema.parse(JSON.parse(await readFile(metadata, 'utf8')))
      if (version.format !== 'asset-bundle') continue
      const object = join(root, 'objects', version.contentHash)
      await assertAncestors(object)
      const bytes = await readFile(object)
      if (
        bytes.length !== version.byteSize ||
        createHash('sha256').update(bytes).digest('hex') !== version.contentHash
      )
        throw new Error('Binary manifest integrity mismatch')
      await storage.verify(JSON.parse(bytes.toString()))
    }
  }
}
