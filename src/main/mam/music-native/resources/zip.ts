import * as yauzl from 'yauzl'
import { mkdir } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { join, dirname } from 'node:path'
const table = Array.from({ length: 256 }, (_, index) => {
  let crc = index
  for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})
export async function extractMusicZip(
  file: string,
  directory: string,
  budget: number,
  signal: AbortSignal
) {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(
      file,
      { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true },
      (error, result) => (error ? reject(error) : resolve(result))
    )
  )
  let total = 0
  const seen = new Set<string>()
  let cancel: (() => void) | undefined
  const abort = () => zip.close()
  signal.addEventListener('abort', abort, { once: true })
  try {
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      zip.once('error', reject)
      zip.once('end', resolve)
      cancel = () => reject(new Error('ZIP extraction cancelled'))
      signal.addEventListener('abort', cancel, { once: true })
      zip.on('entry', (entry: yauzl.Entry) => {
        void (async () => {
          signal.throwIfAborted()
          const name = entry.fileName,
            mode = entry.externalFileAttributes >>> 16
          if (
            (mode & 0xf000 && (mode & 0xf000) !== 0x8000 && (mode & 0xf000) !== 0x4000) ||
            name.includes('\\') ||
            name.includes(':') ||
            name.startsWith('/') ||
            name.split('/').some((part) => part === '..' || part === '.') ||
            name.includes('\0') ||
            name
              .split('/')
              .some(
                (part) =>
                  /[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
              )
          )
            throw new Error('Unsafe ZIP entry')
          const key = name.replace(/\/$/, '').toLowerCase()
          if (!key || seen.has(key)) throw new Error('Duplicate ZIP entry')
          seen.add(key)
          const target = join(directory, name)
          if (name.endsWith('/')) {
            await mkdir(target, { recursive: true })
            zip.readEntry()
            return
          }
          total += entry.uncompressedSize
          if (!Number.isSafeInteger(total) || total > budget)
            throw new Error('ZIP unpacked budget exceeded')
          await mkdir(dirname(target), { recursive: true })
          const source = await new Promise<Readable>((resolve, reject) =>
            zip.openReadStream(entry, (error, stream) => (error ? reject(error) : resolve(stream)))
          )
          let emitted = 0,
            crc = 0xffffffff
          const limit = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              emitted += chunk.length
              for (const byte of chunk) crc = table[(crc ^ byte) & 255]! ^ (crc >>> 8)
              callback(
                emitted > entry.uncompressedSize ? new Error('ZIP expansion exceeded') : null,
                chunk
              )
            }
          })
          await pipeline(source, limit, createWriteStream(target, { flags: 'wx', mode: 0o600 }), {
            signal
          })
          if (emitted !== entry.uncompressedSize || (crc ^ 0xffffffff) >>> 0 !== entry.crc32)
            throw new Error('ZIP checksum mismatch')
          zip.readEntry()
        })().catch(reject)
      })
      zip.readEntry()
    })
  } finally {
    signal.removeEventListener('abort', abort)
    if (cancel) signal.removeEventListener('abort', cancel)
    zip.close()
  }
}
