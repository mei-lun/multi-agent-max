import { readdir, lstat, rename, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function recoverResources(directory: string) {
  const entries = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  for (const entry of entries) {
    const match = /^(runtime|triposg|texture|blender)\.old-[0-9a-f-]+$/.exec(entry)
    if (!match) continue
    const backup = join(directory, entry),
      target = join(directory, match[1]!)
    if ((await lstat(backup)).isSymbolicLink()) throw new Error('Unsafe resource backup')
    try {
      await lstat(target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await rename(backup, target)
      continue
    }
    const manifest = await readFile(join(directory, 'manifest.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => null)
    const marker = await readFile(join(target, '.installed.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => null)
    if (!marker || marker.sha256 !== manifest?.components?.[match[1]!]?.sha256) {
      await rm(target, { recursive: true })
      await rename(backup, target)
      continue
    }
    await rm(backup, { recursive: true })
  }
}
