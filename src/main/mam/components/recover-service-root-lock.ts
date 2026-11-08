import { open, readFile, rename, rm, lstat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

export async function recoverExitedServiceOwner(
  lock: string,
  expected: string,
  pid: number
): Promise<void> {
  const recovery = `${lock}.recovery`
  const guard = await open(recovery, 'wx', 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'EEXIST')
      throw new Error('Creative service recovery in progress; retry shortly')
    throw error
  })
  const retired = `${lock}.${randomUUID()}.retired`
  try {
    if ((await lstat(lock)).isSymbolicLink() || (await readFile(lock, 'utf8')) !== expected)
      throw new Error('Creative owner changed; retry')
    try {
      process.kill(pid, 0)
      throw new Error('Creative owner is still running')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
    await rename(lock, retired)
    await rm(retired)
  } finally {
    await guard.close()
    await rm(recovery)
  }
}
