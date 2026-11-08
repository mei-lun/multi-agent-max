import { test, expect, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  launch: vi.fn(async () => {}),
  installed: vi.fn(async () => ({ runtime: true, triposg: true, texture: true, blender: true }))
}))
vi.mock('electron', () => ({ dialog: {}, nativeImage: {} }))
vi.mock('./launcher', () => ({ runModelLauncher: mocks.launch }))
vi.mock('./resources', () => ({
  names: ['runtime', 'triposg', 'texture', 'blender'],
  model3dResources: (root: string) => ({
    directory: `${root}/resources`,
    installed: mocks.installed
  })
}))
vi.mock('./projects', () => ({
  scopeDirectory: (root: string) => root,
  projectRecord: async () => ({ id: 'a'.repeat(32) }),
  listProjects: async () => [],
  importProject: vi.fn(),
  projectArtifact: vi.fn()
}))
import { createModel3dServices } from './index'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { BinaryAssetStore } from '../creative-runtime/assets'
import type { ComponentRegistry } from '../components/registry'
test('3D launcher resolves exact requested version rather than active package', async () => {
  const root = await mkdtemp(join(tmpdir(), 'model-version-')),
    release = vi.fn(),
    acquire = vi.fn()
  const acquireVersion = vi.fn(async () => ({ packageDirectory: join(root, 'version-a'), release }))
  const service = createModel3dServices({
    root: join(root, 'attempt'),
    resourceRoot: join(root, 'shared'),
    assets: {} as BinaryAssetStore,
    registry: { acquire, acquireVersion } as unknown as ComponentRegistry
  })
  const request = {
    componentId: 'creative.model3d',
    componentVersion: '1.0.0',
    operation: 'model3d.start',
    projectId: 'p',
    idempotencyKey: 'k',
    params: { projectId: 'a'.repeat(32), stage: 'shape' },
    inputAssets: []
  }
  try {
    await service
      .handlers(request)!
      .run(request, { signal: new AbortController().signal, emit: async () => {} })
    expect(acquireVersion).toHaveBeenCalledWith('creative.model3d', '1.0.0')
    expect(acquire).not.toHaveBeenCalled()
    expect(mocks.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        script: join(root, 'version-a', 'modules/model_workbench/launcher.py'),
        python: join(root, 'shared', 'model3d', 'resources', 'runtime/python/python.exe'),
        data: join(root, 'attempt', 'model3d')
      })
    )
    expect(release).toHaveBeenCalledOnce()
  } finally {
    await service.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
