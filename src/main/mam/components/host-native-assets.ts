import { nativeImage, dialog, type BrowserWindow } from 'electron'
import { open, lstat, realpath, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BinaryAssetStore } from '../creative-runtime'
import type { AssetRef } from '../../../shared/mam/creative-runtime'
import { inspectImage } from './host-image-inspection'
import { inspectVideo } from './host-video-inspection'

export function decodeImage(bytes: Buffer): string {
  const mime = inspectImage(bytes)
  const image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) throw new Error('Invalid encoded image')
  const { width, height } = image.getSize()
  if (!width || !height || width > 16384 || height > 16384 || width * height > 40000000)
    throw new Error('Invalid decoded image dimensions')
  return mime
}

export async function importNativeAsset(
  window: BrowserWindow,
  assets: BinaryAssetStore,
  kind: 'media' | 'file' = 'media'
) {
  const selected = await dialog.showOpenDialog(window, { properties: ['openFile'] })
  const file = selected.filePaths[0]
  if (selected.canceled || !file) return null
  const bytes = await readImportSnapshot(file)
  if (kind === 'file')
    return assets.import(
      (async function* () {
        yield bytes
      })(),
      { filename: basename(file), mime: 'application/octet-stream' }
    )
  const header = bytes.subarray(0, 65536)
  let mime: string
  const video = inspectVideo(header)
  if (video) mime = video
  else if (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WAVE')
    mime = 'audio/wav'
  else if (header.toString('ascii', 0, 4) === 'OggS') mime = 'audio/ogg'
  else if (header.toString('ascii', 0, 4) === 'fLaC') mime = 'audio/flac'
  else if (
    header.toString('ascii', 0, 3) === 'ID3' ||
    (header[0] === 255 && (header[1]! & 224) === 224)
  )
    mime = 'audio/mpeg'
  else {
    inspectImage(header)
    if (bytes.length > 33554432) throw new Error('Image size exceeded')
    mime = decodeImage(bytes)
  }
  return assets.import(
    (async function* () {
      yield bytes
    })(),
    { filename: basename(file), mime }
  )
}

export async function exportNativeAsset(
  window: BrowserWindow,
  assets: BinaryAssetStore,
  ref: AssetRef,
  protectedDirectories: readonly string[] = []
) {
  const selected = await dialog.showSaveDialog(window, {
    defaultPath: ref.filename,
    properties: ['showOverwriteConfirmation']
  })
  if (selected.canceled || !selected.filePath) return null
  const target = selected.filePath
  await assertExportDestination(target, protectedDirectories)
  const bytes = await assets.read(ref)
  const temporary = join(dirname(target), `.mam-export-${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } catch (error) {
    await handle.close()
    await unlink(temporary)
    throw error
  }
  await handle.close()
  try {
    await assertExportDestination(target, protectedDirectories)
    try {
      if ((await lstat(target)).isSymbolicLink()) throw new Error('Unsafe export destination')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await rename(temporary, target)
    return true
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

export async function readImportSnapshot(file: string, limit = 512 * 1024 * 1024) {
  const before = await lstat(file)
  if (!before.isFile() || before.isSymbolicLink() || before.size > limit)
    throw new Error('Unsafe import source')
  const handle = await open(file, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.size > limit)
      throw new Error('Unsafe import source')
    const chunks: Buffer[] = []
    let total = 0
    while (true) {
      const chunk = Buffer.alloc(Math.min(65536, limit - total + 1))
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null)
      if (!bytesRead) break
      total += bytesRead
      if (total > limit) throw new Error('Import size exceeded')
      chunks.push(chunk.subarray(0, bytesRead))
    }
    return Buffer.concat(chunks, total)
  } finally {
    await handle.close()
  }
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = dirname(path)
    if (parent === path) throw error
    return join(await canonicalPath(parent), basename(path))
  }
}

export async function assertExportDestination(target: string, roots: readonly string[]) {
  const destination = (await canonicalPath(resolve(target))).toLowerCase()
  for (const root of roots) {
    const protectedRoot = (await canonicalPath(resolve(root))).toLowerCase()
    const suffix = relative(protectedRoot, destination)
    if (!suffix || (!suffix.startsWith('..') && !isAbsolute(suffix)))
      throw new Error('Unsafe export destination: managed storage')
  }
}
