import { mkdir, mkdtemp, lstat, rename, rm } from 'node:fs/promises'
import { dirname, join, basename } from 'node:path'
import { assertAncestors } from '../components/registry/persistence'
const publications = new Set<string>()
export async function publishBinaryDirectory(
  destination: string,
  write: (stage: string) => Promise<void>
) {
  if (publications.has(destination)) throw new Error('Binary destination busy')
  publications.add(destination)
  let stage: string | undefined
  try {
    await assertAncestors(destination)
    try {
      await lstat(destination)
      throw new Error('Binary destination exists')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await mkdir(dirname(destination), { recursive: true })
    stage = await mkdtemp(join(dirname(destination), '.' + basename(destination) + '.stage-'))
    await write(stage)
    // Recheck at commit; application publications are serialized above.
    try {
      await lstat(destination)
      throw new Error('Binary destination exists')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await rename(stage, destination)
    stage = undefined
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true })
    publications.delete(destination)
  }
}
