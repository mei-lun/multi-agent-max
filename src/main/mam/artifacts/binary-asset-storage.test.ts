import { test, expect } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BinaryArtifactStorage } from './binary-asset-storage'
import { AssetBundleSchema } from '../../../shared/mam/domain/binary-artifact'
import { LocalArtifactStore } from './local-artifact-store'
import { ArtifactContractSchema } from '../../../shared/mam/domain/artifact'
const source = { componentId: 'creative.test', componentVersion: '1' }
const stream = async function* (bytes: Buffer) {
  yield bytes.subarray(0, 3)
  yield bytes.subarray(3)
}
test('binary bytes round-trip exactly, deduplicate, and fail on missing or modified content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'binary-artifacts-'))
  try {
    const store = new BinaryArtifactStorage(join(root, 'cas'))
    const bytes = [
      Buffer.from([137, 80, 78, 71, 0, 255]),
      Buffer.from('RIFF\0WAVE'),
      Buffer.from('glTF\0\x02')
    ]
    const bundle = await store.import(
      bytes.map((b, i) => ({
        logicalPath: `nested/${i}.bin`,
        mime: 'application/octet-stream',
        stream: stream(b)
      })),
      source
    )
    await store.import(
      [{ logicalPath: 'same.png', mime: 'image/png', stream: stream(bytes[0]!) }],
      source
    )
    expect(await readdir(join(root, 'cas'))).toHaveLength(3)
    await store.materialize(bundle, join(root, 'task'))
    for (let i = 0; i < 3; i++)
      expect(await readFile(join(root, 'task', `nested/${i}.bin`))).toEqual(bytes[i])
    await expect(store.materialize(bundle, join(root, 'task'))).rejects.toThrow()
    await writeFile(join(root, 'cas', bundle.files[0]!.sha256), 'tampered')
    await expect(store.verify(bundle)).rejects.toThrow()
    await rm(join(root, 'cas', bundle.files[1]!.sha256))
    await expect(store.verify({ ...bundle, files: [bundle.files[1]] })).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('reject Windows path escapes and case/file-prefix collisions', () => {
  const f = (logicalPath: string) => ({
    logicalPath,
    mime: 'image/png',
    bytes: 1,
    sha256: 'a'.repeat(64),
    storageRef: `sha256:${'a'.repeat(64)}`
  })
  for (const paths of [['../x'], ['C:/x'], ['con.txt'], ['x', 'X'], ['dir', 'dir/a']])
    expect(() => AssetBundleSchema.parse({ version: 1, source, files: paths.map(f) })).toThrow()
})
test('formal bundle grants and immutable manifest hash gate downstream reads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'formal-bundle-'))
  try {
    const store = new LocalArtifactStore(root)
    const version = await store.writeAssetBundle({
      artifactId: 'artifact.1',
      artifactType: 'binary.output',
      workflowRunId: 'run.1',
      nodeRunId: 'node.1',
      taskId: 'task.1',
      attemptId: 'attempt.1',
      roleInstanceId: 'role.1',
      inputs: [],
      source,
      contract: ArtifactContractSchema.parse({
        schemaVersion: '1.0.0',
        artifactType: 'binary.output',
        format: 'asset-bundle',
        maxBytes: 10000
      }),
      files: [
        {
          logicalPath: 'output.wav',
          mime: 'audio/wav',
          stream: stream(Buffer.from('RIFF0000WAVE'))
        }
      ]
    })
    const reference = {
      artifactId: version.id,
      version: version.version,
      contentHash: version.contentHash
    }
    await expect(store.readForNode('run.1', 'consumer', reference)).rejects.toThrow()
    await store.registerNodeInputs('run.1', 'consumer', [reference])
    await store.materializeAssetBundleForNode(
      'run.1',
      'consumer',
      reference,
      join(root, 'workspace')
    )
    expect(await readFile(join(root, 'workspace', 'output.wav'))).toEqual(
      Buffer.from('RIFF0000WAVE')
    )
    await store.exportBundleForNode('run.1', 'consumer', reference, join(root, 'portable'))
    const target = new LocalArtifactStore(join(root, 'target'))
    const imported = await target.importAssetBundle({
      directory: join(root, 'portable'),
      artifactId: 'artifact.imported',
      artifactType: 'binary.output',
      workflowRunId: 'run.target',
      nodeRunId: 'node.target',
      taskId: 'task.target',
      attemptId: 'attempt.target',
      roleInstanceId: 'role.target',
      inputs: [],
      contract: ArtifactContractSchema.parse({
        schemaVersion: '1.0.0',
        artifactType: 'binary.output',
        format: 'asset-bundle',
        maxBytes: 10000
      })
    })
    const importedRef = {
      artifactId: imported.id,
      version: imported.version,
      contentHash: imported.contentHash
    }
    expect(imported.workflowRunId).toBe('run.target')
    await target.registerNodeInputs('run.target', 'consume', [importedRef])
    await target.materializeAssetBundleForNode(
      'run.target',
      'consume',
      importedRef,
      join(root, 'target-workspace')
    )
    expect(await readFile(join(root, 'target-workspace', 'output.wav'))).toEqual(
      Buffer.from('RIFF0000WAVE')
    )
    await writeFile(join(root, 'portable', 'files', 'output.wav'), 'tampered')
    await expect(
      target.importAssetBundle({
        directory: join(root, 'portable'),
        artifactId: 'artifact.bad',
        artifactType: 'binary.output',
        workflowRunId: 'run.target',
        nodeRunId: 'node.target',
        taskId: 'task.target',
        attemptId: 'attempt.target',
        roleInstanceId: 'role.target',
        inputs: [],
        contract: ArtifactContractSchema.parse({
          schemaVersion: '1.0.0',
          artifactType: 'binary.output',
          format: 'asset-bundle',
          maxBytes: 10000
        })
      })
    ).rejects.toThrow()
    await rm(join(root, 'binary'), { recursive: true })
    expect(await store.verify(reference)).toBe(false)
    await expect(store.readForNode('run.1', 'consumer', reference)).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
