import { mkdtemp, mkdir, writeFile, rm, lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { BinaryAssetStore } from '../creative-runtime/assets'
import type { CreativeRequest } from '../../../shared/mam/creative-runtime'
import type { OperationHandler } from '../creative-runtime/jobs'
import { assertAncestors } from '../components/registry/persistence'
type Call = (
  action: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal
) => Promise<unknown>
const idPattern = /^[a-f0-9]{32}$/
export async function runMusicJob(
  options: { root: string; assets?: BinaryAssetStore; call: Call; pollMs?: number },
  action: string,
  job: CreativeRequest,
  context: Parameters<OperationHandler['run']>[1]
) {
  const { call, root, assets } = options
  const params = structuredClone(job.params)
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(3600000)])
  if (action === 'reference') {
    if (!assets || job.inputAssets.length !== 1)
      throw new Error('Reference requires one authorized asset')
    const ref = job.inputAssets[0]!
    if (ref.bytes > 64 * 1024 * 1024) throw new Error('Reference too large')
    const bytes = await assets.read(ref),
      header = bytes.toString('ascii', 0, 4)
    if (
      !(header === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') &&
      header !== 'OggS' &&
      header !== 'fLaC' &&
      bytes.toString('ascii', 0, 3) !== 'ID3'
    )
      throw new Error('Unsupported reference audio')
    await assertAncestors(root)
    await mkdir(root, { recursive: true })
    const directory = await mkdtemp(join(root, '.reference-'))
    try {
      const path = join(directory, 'input.audio')
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
      return await call('import_reference', { path }, signal)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
  if (job.inputAssets.length) throw new Error('Unexpected music assets')
  let result = await call(action === 'export' ? 'list' : action, params, signal)
  if (action === 'generate') {
    const id = (result as { id?: unknown })?.id
    if (typeof id !== 'string' || !idPattern.test(id))
      throw new Error('Invalid native music job id')
    await context.emit('log', { type: 'native_music_job', id })
    try {
      for (;;) {
        signal.throwIfAborted()
        // A task cancellation must not corrupt the shared, untagged IPC stream.
        // Finish this bounded read, then cancel only the native job we own.
        const jobs = await call('list', {})
        signal.throwIfAborted()
        if (!Array.isArray(jobs)) throw new Error('Invalid music history')
        const current = jobs.find((value) => value?.id === id)
        if (!current) throw new Error('Native music job disappeared')
        if (current.status === 'succeeded') {
          result = current
          break
        }
        if (['failed', 'cancelled', 'interrupted'].includes(current.status))
          throw new Error('Native music generation did not complete')
        await new Promise<void>((resolve) => setTimeout(resolve, options.pollMs ?? 400))
      }
    } catch (error) {
      if (signal.aborted) await call('cancel', { id }).catch(() => {})
      throw error
    }
  }
  if (action === 'export') {
    if (!Array.isArray(result)) throw new Error('Invalid music history')
    result = result.find((value) => value?.id === params.id)
  }
  if (['generate', 'trim', 'export'].includes(action)) {
    const value = result as { id?: string; status?: string; sha256?: string }
    if (!assets || value?.status !== 'succeeded' || !value.id || !idPattern.test(value.id))
      throw new Error('Music output unavailable')
    const file = join(root, 'outputs', value.id, 'audio.wav')
    await assertAncestors(file)
    const stat = await lstat(file)
    if (!stat.isFile() || stat.size > 512 * 1024 * 1024) throw new Error('Invalid music output')
    const bytes = await readFile(file)
    if (
      bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 12) !== 'WAVE' ||
      !value.sha256 ||
      createHash('sha256').update(bytes).digest('hex') !== value.sha256
    )
      throw new Error('Music output integrity mismatch')
    const ref = await assets.import(
      (async function* () {
        yield bytes
      })(),
      { mime: 'audio/wav', filename: `${value.id}.wav` }
    )
    await context.emit('asset', ref)
    return { job: result, assets: [ref] }
  }
  return result
}
