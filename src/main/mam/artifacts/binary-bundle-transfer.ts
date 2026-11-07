import type { AssetBundle } from '../../../shared/mam/domain/binary-artifact'
import { readFile, writeFile, lstat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import type { LocalArtifactStore, ArtifactWriteRequest } from './local-artifact-store'
import type { BinaryArtifactStorage, BinaryInput } from './binary-asset-storage'
import { AssetBundleSchema } from '../../../shared/mam/domain/binary-artifact'
import {
  ArtifactContractSchema,
  type ArtifactRef,
  type ArtifactVersion
} from '../../../shared/mam/domain/artifact'
import { assertAncestors } from '../components/registry/persistence'
import { publishBinaryDirectory } from './binary-directory-transaction'
import { validateAndEncodeArtifactContent } from './artifact-content-validator'
export async function exportBinaryBundle(
  store: LocalArtifactStore,
  storage: BinaryArtifactStorage,
  workflowRunId: string,
  nodeId: string,
  reference: ArtifactRef,
  destination: string
) {
  const { version, content } = await store.readForNode(workflowRunId, nodeId, reference)
  if (version.format !== 'asset-bundle') throw new Error('Not an asset bundle')
  const manifest = AssetBundleSchema.parse(content)
  await publishBinaryDirectory(destination, async (stage) => {
    // Logical filenames remain inside a dedicated files directory, never beside the transfer manifest.
    await storage.materialize(manifest, join(stage, 'files'))
    const contract = ArtifactContractSchema.parse({
      schemaVersion: '1.0.0',
      artifactType: version.artifactType,
      format: 'asset-bundle',
      maxBytes: 16 * 1024 * 1024
    })
    await writeFile(
      join(stage, 'manifest.json'),
      validateAndEncodeArtifactContent(contract, manifest),
      { flag: 'wx' }
    )
  })
}
export async function importBinaryBundle(
  store: LocalArtifactStore,
  storage: BinaryArtifactStorage,
  request: Omit<ArtifactWriteRequest, 'content'> & { directory: string }
) {
  if (request.contract.format !== 'asset-bundle') throw new Error('Asset bundle contract required')
  await assertAncestors(request.directory)
  const path = join(request.directory, 'manifest.json')
  await assertAncestors(path)
  const stat = await lstat(path)
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error('Invalid transfer manifest')
  const manifest = AssetBundleSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  const files: BinaryInput[] = []
  for (const file of manifest.files) {
    const input = join(request.directory, 'files', ...file.logicalPath.split('/'))
    await assertAncestors(input)
    const details = await lstat(input)
    if (!details.isFile() || details.size !== file.bytes)
      throw new Error('Transfer file unavailable')
    files.push({
      logicalPath: file.logicalPath,
      mime: file.mime,
      stream: (async function* () {
        yield* createReadStream(input)
      })()
    })
  }
  const imported = await storage.import(files, manifest.source)
  if (JSON.stringify(imported) !== JSON.stringify(manifest))
    throw new Error('Transfer integrity mismatch')
  return store.put({ ...request, content: imported })
}
export async function writeBinaryBundle(
  store: LocalArtifactStore,
  storage: BinaryArtifactStorage,
  request: Omit<ArtifactWriteRequest, 'content'> & {
    files: readonly BinaryInput[]
    source: AssetBundle['source']
  }
): Promise<ArtifactVersion> {
  if (request.contract.format !== 'asset-bundle') throw new Error('Asset bundle contract required')
  const content = await storage.import(request.files, request.source)
  return store.put({ ...request, content })
}
export async function materializeBinaryBundle(
  store: LocalArtifactStore,
  storage: BinaryArtifactStorage,
  workflowRunId: string,
  nodeId: string,
  reference: ArtifactRef,
  destination: string
) {
  const { version, content } = await store.readForNode(workflowRunId, nodeId, reference)
  if (version.format !== 'asset-bundle') throw new Error('Not an asset bundle')
  await storage.materialize(content, destination)
}
