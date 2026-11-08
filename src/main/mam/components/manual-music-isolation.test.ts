import { expect, test, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPackageRuntime } from './package-runtime'
import { packageDataScope } from './package-data-scope'
import { ComponentRegistry } from './registry'
import { BinaryAssetStore } from '../creative-runtime/assets'
import { RifeSettings } from './host-rife-settings'
import type { AssetRef, CreativeRequest } from '../../../shared/mam/creative-runtime'
vi.mock('electron', () => ({ dialog: {}, nativeImage: {} }))

test('production package isolates manual project music status/export/archive and retains legacy drafts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manual-music-'))
  let runtime: ReturnType<typeof createPackageRuntime> | undefined
  try {
    const source = join(root, 'source')
    await mkdir(source)
    const operations = ['music.status', 'music.list', 'music.export', 'music.archive'].map(
      (id) => ({ id, title: id, description: '', requiredCapabilities: [] })
    )
    await writeFile(
      join(source, 'manifest.json'),
      JSON.stringify({
        id: 'creative.music',
        version: '0.3.0',
        hostApiVersion: '2.0.0',
        minimumHostVersion: '0.1.43',
        platforms: [{ os: process.platform, arch: process.arch }],
        source: { commit: 'a'.repeat(40), sha256: 'b'.repeat(64) },
        uiEntrypoint: 'backend.cjs',
        files: {},
        dependencies: [],
        resources: [],
        operations
      })
    )
    const builder = pathToFileURL(resolve('config/scripts/build-creative-runtime.mjs')).href
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {buildCreativeRuntime} from ${JSON.stringify(builder)}; await buildCreativeRuntime(${JSON.stringify(source)})`
      ],
      { windowsHide: true }
    )
    const registry = new ComponentRegistry({
      root: join(root, 'registry'),
      hostVersion: '0.1.43',
      hostApiVersion: '2.0.0'
    })
    const manifest = await registry.install({ sourceDirectory: source, trustLocal: true })
    await registry.enable({ id: manifest.id, version: manifest.version })
    const assets = await BinaryAssetStore.open(join(root, 'assets'))
    runtime = createPackageRuntime({
      root,
      registry,
      assets,
      rifeSettings: new RifeSettings(join(root, 'rife'))
    })
    const media = {
      catalog: {
        models: { listActive: () => [], getActive: () => undefined },
        providers: { getActive: () => undefined }
      },
      resolveSecret: () => undefined
    }
    const handlers = runtime.runtimeHandlers(media)
    const seed = async (project: string, id: string) => {
      const music = join(packageDataScope(root, project).root, 'music')
      await mkdir(join(music, 'outputs', id), { recursive: true })
      const wav = Buffer.from('RIFF0000WAVEfixture')
      await writeFile(join(music, 'outputs', id, 'audio.wav'), wav)
      const db = new DatabaseSync(join(music, 'library.sqlite3'))
      try {
        db.exec('CREATE TABLE jobs (id TEXT PRIMARY KEY,data TEXT)')
        db.prepare('INSERT INTO jobs VALUES (?,?)').run(
          id,
          JSON.stringify({
            id,
            status: 'succeeded',
            sha256: createHash('sha256').update(wav).digest('hex'),
            archived: false
          })
        )
      } finally {
        db.close()
      }
      return wav
    }
    const aId = 'a'.repeat(32),
      legacyId = 'c'.repeat(32)
    const wav = await seed('project-A', aId)
    await seed('creative.local', legacyId)
    const run = (projectId: string, operation: string, params: Record<string, unknown> = {}) => {
      const request: CreativeRequest = {
        componentId: 'creative.music',
        componentVersion: manifest.version,
        projectId,
        operation,
        params,
        inputAssets: [],
        idempotencyKey: crypto.randomUUID()
      }
      return handlers(request)!.run(request, {
        signal: new AbortController().signal,
        emit: async () => {}
      })
    }
    // Catalog must not initialize/reuse a native service for any project.
    await runtime.listModels(media)
    expect(await run('project-A', 'music.list')).toMatchObject([{ id: aId }])
    expect(await run('project-B', 'music.status')).toMatchObject({ jobs: [] })
    expect(await run('project-B', 'music.list')).toEqual([])
    await expect(run('project-B', 'music.export', { id: aId })).rejects.toThrow(
      'Music output unavailable'
    )
    await expect(run('project-B', 'music.archive', { id: aId, archived: true })).rejects.toThrow()
    expect(await run('project-A', 'music.list')).toMatchObject([{ id: aId, archived: false }])
    const exported = (await run('project-A', 'music.export', { id: aId })) as { assets: AssetRef[] }
    expect(await assets.read(exported.assets[0]!)).toEqual(wav)
    expect(await run('creative.local', 'music.list')).toMatchObject([{ id: legacyId }])
    expect(await run('project-B', 'music.list')).toEqual([])
  } finally {
    await runtime?.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
