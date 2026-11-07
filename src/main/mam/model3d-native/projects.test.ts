import { test, expect, vi } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BinaryAssetStore } from '../creative-runtime/assets'
import { importProject, projectArtifact, scopeDirectory, projectRecord } from './projects'
vi.mock('electron', () => ({ nativeImage: {}, dialog: {} }))
test('owned import reference preserves stages and artifacts reject foreign/traversal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'model-project-'))
  try {
    const assets = await BinaryAssetStore.open(join(root, 'assets')),
      bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      ref = await assets.import(
        (async function* () {
          yield bytes
        })(),
        { filename: 'source.png', mime: 'image/png' }
      )
    const request = {
        projectId: 'workspace',
        componentId: 'creative.model3d',
        componentVersion: '1',
        operation: 'model3d.import',
        idempotencyKey: 'k',
        params: {},
        inputAssets: [ref]
      },
      data = scopeDirectory(root, request)
    const project = await importProject(data, request, assets, () => 'image/png')
    const run = 'a'.repeat(32),
      directory = join(data, 'projects', project.id, 'runs', run)
    await mkdir(directory, { recursive: true })
    project.stages = { shape: { directory: `runs/${run}` } }
    await writeFile(join(data, 'projects', project.id, 'project.json'), JSON.stringify(project))
    const updated = await importProject(
      data,
      { ...request, params: { projectId: project.id } },
      assets,
      () => 'image/png',
      true
    )
    expect(updated.stages).toEqual(project.stages)
    const glb = Buffer.alloc(12)
    glb.write('glTF')
    glb.writeUInt32LE(2, 4)
    glb.writeUInt32LE(12, 8)
    await writeFile(join(directory, 'model.glb'), glb)
    const output = await projectArtifact(
      data,
      { projectId: project.id, stage: 'shape', name: 'model.glb' },
      assets
    )
    expect(await assets.read(output)).toEqual(glb)
    await expect(
      projectArtifact(data, { projectId: project.id, stage: 'shape', name: '../secret' }, assets)
    ).rejects.toThrow()
    await expect(
      projectRecord(scopeDirectory(root, { ...request, projectId: 'foreign' }), project.id)
    ).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
