import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ComponentId } from '../../../shared/mam/components'
import type { ComponentRegistry } from './registry'

export async function acquireAttemptComponent(
  registry: ComponentRegistry,
  directory: string,
  id: ComponentId,
  version?: string
) {
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${id}.identity.json`)
  let frozen: { version: string; manifestHash: string } | undefined
  try {
    frozen = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (frozen && version && frozen.version !== version)
    throw new Error('Frozen component version mismatch')
  const lease =
    frozen || version
      ? await registry.acquireVersion(id, frozen?.version ?? version!)
      : await registry.acquire(id)
  try {
    const identity = {
      version: lease.manifest.version,
      manifestHash: createHash('sha256').update(JSON.stringify(lease.manifest)).digest('hex')
    }
    if (frozen) {
      if (frozen.manifestHash !== identity.manifestHash)
        throw new Error('Frozen component manifest mismatch')
    } else {
      try {
        await writeFile(path, JSON.stringify(identity), { flag: 'wx' })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if ((await readFile(path, 'utf8')) !== JSON.stringify(identity))
          throw new Error('Concurrent component identity mismatch')
      }
    }
    return { ...lease, identity }
  } catch (error) {
    lease.release()
    throw error
  }
}
