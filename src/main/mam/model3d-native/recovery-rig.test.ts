import { test, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recoverResources } from './resource-recovery'
import { rigPython } from './rig-python'

test('interrupted replacement restores old resource until manifest commit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'resource-recovery-'))
  try {
    await mkdir(join(root, 'runtime.old-abc'))
    await writeFile(join(root, 'runtime.old-abc', 'original'), 'preserved')
    await mkdir(join(root, 'runtime'))
    await writeFile(join(root, 'runtime', '.installed.json'), JSON.stringify({ sha256: 'new' }))
    await writeFile(
      join(root, 'manifest.json'),
      JSON.stringify({ components: { runtime: { sha256: 'old' } } })
    )
    await recoverResources(root)
    expect(await readFile(join(root, 'runtime', 'original'), 'utf8')).toBe('preserved')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rig resolves Blender Python without an inference runtime', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rig-python-'))
  try {
    const bin = join(root, 'blender', '4.5', 'python', 'bin')
    await mkdir(bin, { recursive: true })
    await writeFile(join(bin, 'python.exe'), 'fixture')
    expect(await rigPython(root)).toBe(join(bin, 'python.exe'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
