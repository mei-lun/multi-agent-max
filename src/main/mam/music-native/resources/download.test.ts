import { expect, test } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { downloadResource } from './download'
test.each(['complete', 'partial'])('corrupt %s cache retries full download once', async (kind) => {
  const directory = await mkdtemp(join(tmpdir(), 'music-cache-')),
    file = join(directory, 'part')
  const bytes = Buffer.from('verified-resource'),
    requests: string[] = []
  const server = createServer((req, res) => {
    requests.push(req.headers.range ?? 'full')
    const offset = Number(req.headers.range?.match(/\d+/)?.[0] ?? 0)
    if (offset) {
      res.statusCode = 206
      res.setHeader('content-range', `bytes ${offset}-${bytes.length - 1}/${bytes.length}`)
    }
    res.end(bytes.subarray(offset))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await writeFile(file, kind === 'complete' ? Buffer.alloc(bytes.length) : Buffer.from('bad'))
    await downloadResource(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      file,
      { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
      fetch,
      new AbortController().signal,
      () => {}
    )
    expect(await readFile(file)).toEqual(bytes)
    expect(requests).toEqual(kind === 'complete' ? ['full'] : ['bytes=3-', 'full'])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})
test('cancellation retains downloaded partial cache and never retries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'music-cancel-')),
    file = join(directory, 'part'),
    controller = new AbortController()
  let calls = 0
  try {
    await expect(
      downloadResource(
        'http://fixture',
        file,
        { bytes: 100, sha256: '0'.repeat(64) },
        async () => {
          calls++
          return new Response(new Uint8Array([1, 2, 3]))
        },
        controller.signal,
        () => controller.abort()
      )
    ).rejects.toThrow()
    expect(calls).toBe(1)
    expect(await readFile(file)).toEqual(Buffer.from([1, 2, 3]))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
