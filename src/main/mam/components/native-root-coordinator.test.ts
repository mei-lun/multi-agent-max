import { test, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMusicResourceManager } from '../music-native/resources'
import { nativeRootCoordinator } from './native-root-coordinator'
test('independent managers of the same resource root share pins and busy state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-coordinator-'))
  try {
    const first = createMusicResourceManager({ root }),
      second = createMusicResourceManager({ root: join(root, '.') })
    const release = first.pin('musicgen')
    await expect(second.remove('musicgen')).rejects.toThrow('in use')
    await expect(second.install('musicgen')).rejects.toThrow('in use')
    release()
    await second.remove('musicgen')
    const shared = nativeRootCoordinator(root)
    shared.busy = true
    expect(() => first.pin('musicgen')).toThrow('in progress')
    shared.busy = false
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
