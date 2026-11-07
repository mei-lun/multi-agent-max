import { expect, test, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('electron', () => ({ nativeImage: {}, dialog: {} }))
import { assertExportDestination, readImportSnapshot } from './host-native-assets'

test('export rejects managed root, case aliases and symlink ancestors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-export-'))
  try {
    const managed = join(root, 'managed')
    await mkdir(managed)
    await assertExportDestination(join(root, 'external.wav'), [managed])
    await expect(assertExportDestination(join(managed, 'jobs.json'), [managed])).rejects.toThrow(
      'managed'
    )
    await expect(
      assertExportDestination(join(root, 'MANAGED', 'asset'), [managed])
    ).rejects.toThrow('managed')
    await symlink(managed, join(root, 'alias'), 'junction')
    await expect(assertExportDestination(join(root, 'alias', 'asset'), [managed])).rejects.toThrow(
      'managed'
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('import snapshot enforces byte bounds and remains independent of later path writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-import-'))
  try {
    const file = join(root, 'source')
    await writeFile(file, 'original')
    const snapshot = await readImportSnapshot(file, 8)
    await writeFile(file, 'replacement')
    expect(snapshot.toString()).toBe('original')
    await expect(readImportSnapshot(file, 8)).rejects.toThrow('Unsafe')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
