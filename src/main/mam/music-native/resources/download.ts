import { open, lstat, unlink } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
export async function verifyResource(file: string, bytes: number, sha256: string) {
  const stat = await lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== bytes)
    throw new Error('Resource byte length mismatch')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  if (hash.digest('hex') !== sha256) throw new Error('Resource hash mismatch')
}
async function downloadAttempt(
  url: string,
  file: string,
  expected: { bytes: number; sha256: string },
  fetcher: typeof fetch,
  signal: AbortSignal,
  progress: (bytes: number) => void
) {
  let offset = 0
  try {
    const stat = await lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe partial resource')
    offset = stat.size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (offset > expected.bytes) throw new Error('Partial resource exceeds limit')
  if (offset === expected.bytes) {
    await verifyResource(file, expected.bytes, expected.sha256)
    return
  }
  const response = await fetcher(url, {
    headers: offset ? { Range: `bytes=${offset}-` } : {},
    signal,
    redirect: 'follow'
  })
  if (!response.ok || !response.body) throw new Error('Resource download failed')
  if (offset && response.status === 206) {
    const range = response.headers.get('content-range')
    if (!range?.startsWith(`bytes ${offset}-`) || !range.endsWith(`/${expected.bytes}`))
      throw new Error('Invalid resumed resource range')
  } else if (response.status === 200) offset = 0
  else throw new Error('Invalid resource download status')
  const handle = await open(file, offset ? 'a' : 'w', 0o600)
  try {
    let received = offset
    for await (const chunk of response.body) {
      signal.throwIfAborted()
      received += chunk.length
      if (received > expected.bytes) throw new Error('Resource exceeds byte budget')
      await handle.writeFile(chunk)
      progress(chunk.length)
    }
    await handle.sync()
  } finally {
    await handle.close()
  }
  await verifyResource(file, expected.bytes, expected.sha256)
}

export async function downloadResource(
  url: string,
  file: string,
  expected: { bytes: number; sha256: string },
  fetcher: typeof fetch,
  signal: AbortSignal,
  progress: (bytes: number) => void
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await downloadAttempt(url, file, expected, fetcher, signal, progress)
    } catch (error) {
      signal.throwIfAborted()
      if (attempt || !(error instanceof Error) || error.message !== 'Resource hash mismatch')
        throw error
      // Only the caller-selected cache file is removed, after rechecking its type.
      const stat = await lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe corrupt resource cache')
      await unlink(file)
    }
  }
}
