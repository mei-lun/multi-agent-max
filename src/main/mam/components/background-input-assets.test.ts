import { test, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BinaryAssetStore } from '../creative-runtime/assets'
import { packageAssets } from './package-assets'
import { backgroundInputAssets } from '../../../../packages/creative-writing/background-jobs'
vi.mock('electron', () => ({ dialog: {}, nativeImage: {} }))
test('embedded original graph refs receive real broker grants; omitted refs remain denied', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'background-inputs-'))
  try {
    const store = await BinaryAssetStore.open(directory)
    const ref = await store.import(
      (async function* () {
        yield Buffer.from('actual original content')
      })(),
      { mime: 'text/plain', filename: 'source.txt' }
    )
    const graph = {
      nodes: [
        {
          data: {
            inputAttachments: [{ id: ref.id, assetRef: ref }],
            references: [{ assetRef: ref }]
          }
        }
      ]
    }
    const inputs = backgroundInputAssets({ graph })
    expect(inputs).toEqual([ref])
    const broker = packageAssets(store, inputs)
    expect(
      Buffer.from(
        (await broker.call('asset.read', { ref, offset: 0 })) as string,
        'base64'
      ).toString()
    ).toBe('actual original content')
    await expect(packageAssets(store, []).call('asset.read', { ref, offset: 0 })).rejects.toThrow(
      'access denied'
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
