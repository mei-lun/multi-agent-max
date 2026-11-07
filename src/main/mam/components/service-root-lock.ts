import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { assertAncestors } from './registry/persistence'

export async function acquireServiceRootLock(root: string) {
  const directory = resolve(root)
  await assertAncestors(join(directory, '.creative-owner'))
  await mkdir(directory, { recursive: true })
  const lock = join(directory, '.creative-owner'),
    token = randomUUID()
  const owner = JSON.stringify({ pid: process.pid, token })
  try {
    const handle = await open(lock, 'wx', 0o600)
    try {
      await handle.writeFile(owner)
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if ((await lstat(lock)).isSymbolicLink()) throw new Error('Unsafe creative service lock')
    let previous: { pid: number; token: string }
    try {
      previous = JSON.parse(await readFile(lock, 'utf8')) as typeof previous
    } catch {
      throw new Error(
        'Incomplete creative service lock; close all instances and inspect .creative-owner before removing it'
      )
    }
    if (
      !Number.isSafeInteger(previous.pid) ||
      previous.pid <= 0 ||
      typeof previous.token !== 'string'
    )
      throw new Error('Invalid creative service lock; manual recovery required')
    try {
      process.kill(previous.pid, 0)
    } catch (probe) {
      if ((probe as NodeJS.ErrnoException).code === 'ESRCH')
        throw new Error(
          `Stale creative service lock for exited PID ${previous.pid}; close all instances and remove ${lock} to retry`
        )
      throw new Error('Cannot establish creative service owner status; lock retained')
    }
    throw new Error(`Creative services already owned by process ${previous.pid}`)
  }
  let released = false
  return {
    directory,
    release: async () => {
      if (released) return
      if ((await readFile(lock, 'utf8')) !== owner)
        throw new Error('Creative service lock ownership changed')
      const retired = `${lock}.${token}.released`
      await rename(lock, retired)
      released = true
      await rm(retired)
    }
  }
}
