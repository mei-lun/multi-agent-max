import { spawn, type SpawnOptions, type ChildProcess } from 'node:child_process'
import { mkdtemp, writeFile, lstat, readFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, isAbsolute } from 'node:path'
import type { CreativeRequest } from '../../../shared/mam/creative-runtime'
import type { BinaryAssetStore } from '../creative-runtime/assets'
import type { OperationHandler } from '../creative-runtime/jobs'
import { spineRifeSchema } from '../../../shared/mam/spine-native'
export type RifeConfig = { executable: string; modelDirectory: string }
export function rifeHandler(
  request: CreativeRequest,
  options: {
    assets: BinaryAssetStore
    validateImage: (bytes: Buffer) => string
    config: RifeConfig
    spawnProcess?: (executable: string, args: string[], options: SpawnOptions) => ChildProcess
  }
): OperationHandler {
  const params = spineRifeSchema.parse(request.params),
    config = structuredClone(options.config)
  if (
    request.inputAssets.length !== 2 ||
    request.inputAssets.some((ref) => ref.bytes > 4 * 1024 * 1024)
  )
    throw new Error('RIFE requires two bounded PNG frames')
  if (!isAbsolute(config.executable) || !isAbsolute(config.modelDirectory))
    throw new Error('RIFE host paths must be absolute')
  return {
    validate() {},
    async run(_accepted, context) {
      const frames = []
      for (const ref of request.inputAssets) {
        const bytes = await options.assets.read(ref)
        if (
          options.validateImage(bytes) !== 'image/png' ||
          bytes.length < 24 ||
          bytes.readUInt32BE(16) > 512 ||
          bytes.readUInt32BE(20) > 512
        )
          throw new Error('RIFE requires PNG frames up to 512px')
        frames.push(bytes)
      }
      if (!frames[0]!.subarray(16, 24).equals(frames[1]!.subarray(16, 24)))
        throw new Error('RIFE frame dimensions differ')
      const executable = await realpath(config.executable),
        model = await realpath(config.modelDirectory)
      if (!(await lstat(executable)).isFile()) throw new Error('RIFE executable missing')
      for (const file of ['flownet.bin', 'flownet.param'])
        if (!(await lstat(join(model, file))).isFile()) throw new Error('RIFE model missing')
      const directory = await mkdtemp(join(tmpdir(), 'mam-spine-rife-'))
      try {
        const first = join(directory, 'first.png'),
          last = join(directory, 'last.png'),
          output = join(directory, 'result.png')
        await writeFile(first, frames[0]!)
        await writeFile(last, frames[1]!)
        const signal = AbortSignal.any([context.signal, AbortSignal.timeout(90000)])
        signal.throwIfAborted()
        const child = (options.spawnProcess ?? spawn)(
          executable,
          [
            '-0',
            first,
            '-1',
            last,
            '-o',
            output,
            '-m',
            model,
            '-s',
            String(params.fraction),
            '-g',
            String(params.gpu),
            '-j',
            '1:1:1'
          ],
          { cwd: dirname(executable), windowsHide: true, shell: false, stdio: 'ignore' }
        )
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            child.kill()
          }
          signal.addEventListener('abort', abort, { once: true })
          child.once('error', () => {
            signal.removeEventListener('abort', abort)
            reject(new Error('RIFE could not start'))
          })
          child.once('exit', (code) => {
            signal.removeEventListener('abort', abort)
            if (signal.aborted) reject(new Error('RIFE cancelled or timed out'))
            else if (code === 0) resolve()
            else reject(new Error('RIFE process failed'))
          })
          if (signal.aborted) abort()
        })
        const stat = await lstat(output)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024)
          throw new Error('Invalid RIFE output')
        const bytes = await readFile(output)
        if (
          options.validateImage(bytes) !== 'image/png' ||
          !frames[0]!.subarray(16, 24).equals(bytes.subarray(16, 24))
        )
          throw new Error('Invalid RIFE canvas')
        const assetRef = await options.assets.import(
          (async function* () {
            yield bytes
          })(),
          { filename: 'rife-frame.png', mime: 'image/png' }
        )
        await context.emit('asset', assetRef)
        return { assetRef }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  }
}
