import { lstat, mkdir, readFile, rename, open, unlink } from 'node:fs/promises'
import { dirname, resolve, parse, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export async function safeDirectory(directory: string): Promise<string> {
  const full = resolve(directory)
  let current = parse(full).root
  for (const segment of full.slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, segment)
    await mkdir(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    const stat = await lstat(current)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe storage directory')
  }
  return full
}
export async function readSafe(path: string): Promise<Buffer> {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe storage file')
  return readFile(path)
}
export async function atomicJson(path: string, value: unknown): Promise<void> {
  await safeDirectory(dirname(path))
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    const handle = await open(temp, 'wx', 0o600)
    try {
      await handle.writeFile(JSON.stringify(value))
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temp, path)
    await syncDirectory(dirname(path))
  } finally {
    await unlink(temp).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}
export async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (
      ![
        'EINVAL',
        'ENOTSUP',
        'EISDIR',
        ...(process.platform === 'win32' ? ['EPERM', 'EACCES'] : [])
      ].includes((error as NodeJS.ErrnoException).code ?? '')
    )
      throw error
  }
}
