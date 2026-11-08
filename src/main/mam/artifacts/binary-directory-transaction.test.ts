import { test, expect } from 'vitest'
import { mkdtemp, writeFile, readFile, rm, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publishBinaryDirectory } from './binary-directory-transaction'
import { BinaryArtifactStorage } from './binary-asset-storage'
test('partial publication failure cleans only stage and retries same destination', async () => {
  const root = await mkdtemp(join(tmpdir(), 'binary-publish-')),
    target = join(root, 'output')
  try {
    await expect(
      publishBinaryDirectory(target, async (stage) => {
        await writeFile(join(stage, 'first'), 'first')
        throw Error('disk full')
      })
    ).rejects.toThrow('disk full')
    await expect(lstat(target)).rejects.toThrow()
    await publishBinaryDirectory(target, async (stage) => {
      await writeFile(join(stage, 'first'), 'complete')
    })
    await expect(publishBinaryDirectory(target, async () => {})).rejects.toThrow('exists')
    expect(await readFile(join(target, 'first'), 'utf8')).toBe('complete')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('sync availability uses prepared shared identity cache and revokes changed bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'binary-cache-'))
  try {
    const store = new BinaryArtifactStorage(root),
      bundle = await store.import(
        [
          {
            logicalPath: 'large.bin',
            mime: 'application/octet-stream',
            stream: (async function* () {
              yield Buffer.alloc(2 * 1024 * 1024, 7)
            })()
          }
        ],
        { componentId: 'c', componentVersion: '1' }
      )
    expect(() => new BinaryArtifactStorage(root).verifySync(bundle)).toThrow('verification_pending')
    await store.verify(bundle)
    expect(() => new BinaryArtifactStorage(root).verifySync(bundle)).not.toThrow()
    const file = join(root, bundle.files[0]!.sha256)
    await writeFile(file, Buffer.alloc(2 * 1024 * 1024, 8))
    expect(() => store.verifySync(bundle)).toThrow('verification_pending')
    await expect(store.verify(bundle)).rejects.toThrow('integrity')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
