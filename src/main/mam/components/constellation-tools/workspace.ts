import { realpath, lstat, open, readdir } from 'node:fs/promises'
import { resolve, relative, isAbsolute, join } from 'node:path'
export const within = (root: string, path: string) => {
  const suffix = relative(root, path)
  return !suffix || (!suffix.startsWith('..') && !isAbsolute(suffix))
}
export async function workspacePath(root: string, path: string) {
  const target = await realpath(resolve(root, path))
  if (!within(root, target)) throw new Error('Path outside selected workspace')
  return target
}
export async function readWorkspaceFile(root: string, path: string, encoding = 'utf-8') {
  const file = await workspacePath(root, path),
    stat = await lstat(file)
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('File must be at most 1 MiB')
  const handle = await open(file, 'r')
  try {
    const bytes = Buffer.alloc(1024 * 1024 + 1)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    if (bytesRead > 1024 * 1024) throw new Error('File exceeds limit')
    return new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}
export async function listWorkspace(root: string, path: string, query?: string) {
  const start = await workspacePath(root, path),
    result: string[] = [],
    pending = [start]
  let visited = 0
  while (pending.length && visited < 1000) {
    const directory = pending.shift()!
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++visited > 1000) break
      const file = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (query) pending.push(file)
        else result.push(relative(root, file) + '/')
      } else if (entry.isFile()) {
        if (!query) result.push(relative(root, file))
        else {
          try {
            const text = await readWorkspaceFile(root, file)
            for (const [index, line] of text.split('\n').entries())
              if (line.includes(query)) {
                result.push(`${relative(root, file)}:${index + 1}:${line.slice(0, 500)}`)
                if (result.length >= 200) return result.join('\n').slice(0, 120000)
              }
          } catch {
            /* Binary/large files are not text search inputs. */
          }
        }
      }
    }
  }
  return result.join('\n').slice(0, 120000)
}
