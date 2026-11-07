import { expect, test } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireServiceRootLock } from './service-root-lock'
test('exclusive root ownership, release and conservative malformed/stale recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creative-lock-'))
  try {
    const lock = await acquireServiceRootLock(root)
    await expect(acquireServiceRootLock(root)).rejects.toThrow('already owned')
    await lock.release()
    await lock.release()
    const next = await acquireServiceRootLock(root)
    await next.release()
    await writeFile(join(root, '.creative-owner'), '')
    await expect(acquireServiceRootLock(root)).rejects.toThrow('Incomplete')
    await writeFile(
      join(root, '.creative-owner'),
      JSON.stringify({ pid: 2147483647, token: 'stale' })
    )
    await expect(acquireServiceRootLock(root)).rejects.toThrow('Stale')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
