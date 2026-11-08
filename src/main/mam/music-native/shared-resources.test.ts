import { expect, test, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createDesktopMusicServices } from './desktop'
import { musicResourceSpecs } from './resources/specs'
import type { BinaryAssetStore } from '../creative-runtime/assets'
import type { ComponentRegistry } from '../components/registry'
vi.mock('electron', () => ({ dialog: {} }))

test('new Attempt sees manually installed engine but executes with separate writable job data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shared-engine-'))
  const spec = musicResourceSpecs.musicgen,
    resources = join(root, 'music', 'resources', spec.resourceVersion)
  const put = async (file: string, text: string) => {
    const path = join(resources, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }
  try {
    await put('.registered.json', JSON.stringify({ resourceVersion: spec.resourceVersion }))
    for (const file of [
      'runtime/python.exe',
      'runtime/Lib/site-packages/torch/__init__.py',
      'musicgen-small/model.safetensors',
      'musicgen-small/config.json'
    ])
      await put(file, 'x')
    await put('runtime/ready.json', '{}')
    await put(
      'musicgen-small/manifest.json',
      JSON.stringify({
        revision: spec.modelRevision,
        files: [{ file: 'model.safetensors', bytes: 1 }]
      })
    )
    const scope = join(root, 'package-scopes', 'attempt-a')
    let launch: Record<string, unknown> | undefined
    const service = createDesktopMusicServices({
      root: scope,
      resourceRoot: root,
      assets: {} as BinaryAssetStore,
      registry: {
        acquire: async () => ({ packageDirectory: 'pinned-package', release() {} })
      } as unknown as ComponentRegistry,
      coreFactory: ((options: Record<string, unknown>) => {
        launch = options
        return {
          handlers: () => ({ validate() {}, run: async () => ['scoped-command-result'] }),
          dispose: async () => {}
        }
      }) as never
    })
    const request = {
      componentId: 'creative.music',
      componentVersion: '0.3.0',
      projectId: 'p',
      attempt: { id: 'a', serverId: 's' },
      operation: 'music.status',
      params: {},
      inputAssets: [],
      idempotencyKey: 'a'
    }
    const context = { signal: new AbortController().signal, emit: async () => {} }
    const status = (await service.handlers(request)!.run(request, context)) as {
      runtimeReady: boolean
    }
    expect(status.runtimeReady).toBe(true)
    const command = { ...request, operation: 'music.list' }
    expect(await service.handlers(command)!.run(command, context)).toEqual([
      'scoped-command-result'
    ])
    expect(launch).toMatchObject({
      root: join(scope, 'music'),
      installedEngineRoots: { musicgen: resources }
    })
    await service.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
