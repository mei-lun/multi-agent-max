import { expect, test, vi } from 'vitest'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PackageProcess } from './package-process'
import { packageAssets } from './package-assets'
import { BinaryAssetStore } from '../creative-runtime/assets'
import type { AssetRef } from '../../../shared/mam/creative-runtime'
vi.mock('electron', () => ({ dialog: {}, nativeImage: {} }))

test('production package bundle executes original writing exporter through bounded host asset RPC', async () => {
  const root = await mkdtemp(join(tmpdir(), 'package-production-'))
  let child: PackageProcess | undefined
  try {
    await writeFile(
      join(root, 'manifest.json'),
      JSON.stringify({ id: 'creative.writing', files: {}, operations: [] })
    )
    const builder = pathToFileURL(resolve('config/scripts/build-creative-runtime.mjs')).href
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {buildCreativeRuntime} from ${JSON.stringify(builder)}; await buildCreativeRuntime(${JSON.stringify(root)})`
      ],
      { windowsHide: true }
    )
    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
    expect(manifest.runtimeEntrypoint).toBe('backend.cjs')
    expect(manifest.operations.map((o: { id: string }) => o.id)).toContain('writing.project.export')
    const assets = await BinaryAssetStore.open(join(root, 'assets'))
    const capability = packageAssets(assets, [])
    const events: unknown[] = []
    let chunks = 0
    child = new PackageProcess(join(root, manifest.runtimeEntrypoint))
    const result = (await child.invoke(
      {
        root,
        packageDirectory: root,
        models: [],
        providers: [],
        request: {
          componentId: 'creative.writing',
          componentVersion: manifest.version,
          operation: 'writing.project.export',
          projectId: 'fixture',
          inputAssets: [],
          idempotencyKey: 'fixture',
          params: {
            format: 'markdown',
            project: {
              schemaVersion: 1,
              title: 'Original exporter fixture',
              documents: [{ id: 'chapter', content: 'A'.repeat(2 * 1024 * 1024) }]
            }
          }
        }
      },
      new AbortController().signal,
      async (method, value) => {
        if (method === 'event') {
          events.push(value)
          return null
        }
        if (method === 'asset.chunk') chunks++
        return capability.call(method, value)
      }
    )) as { assets: AssetRef[]; text: string }
    expect(result.text).toContain('Original exporter fixture')
    expect((await assets.read(result.assets[0]!)).toString('utf8')).toBe(result.text)
    expect(events).toHaveLength(1)
    expect(chunks).toBeGreaterThan(1)
    await expect(
      capability.call('asset.read', {
        ref: { ...result.assets[0], id: '00000000-0000-4000-8000-000000000000' },
        offset: 0
      })
    ).rejects.toThrow('access denied')
  } finally {
    await child?.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
