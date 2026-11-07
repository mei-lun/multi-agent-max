import { mkdir, readFile, writeFile, rename, rm, realpath, lstat, open } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import type { MusicEngine, MusicResourceSpec } from '../../../../shared/mam/music-native'
import { validateMusicManifest } from '../resource-manifest'
import { musicResourceSpecs, musicComponentNames, resourceUrl, manifestName } from './specs'
import { downloadResource, verifyResource } from './download'
import { extractMusicZip } from './zip'
import { verifyMusicReadiness } from './readiness'
import { nativeRootCoordinator } from '../../components/native-root-coordinator'
type Progress = { phase: 'download' | 'extract' | 'ready'; bytes: number; total: number }
type Control = { signal?: AbortSignal; onProgress?: (progress: Progress) => void }
export function createMusicResourceManager(options: {
  root: string
  fetch?: typeof fetch
  specs?: Record<MusicEngine, MusicResourceSpec>
  assetUrl?: (spec: MusicResourceSpec, name: string) => string
  verifyReady?: typeof verifyMusicReadiness
}) {
  const root = resolve(options.root),
    specs = options.specs ?? musicResourceSpecs,
    fetcher = options.fetch ?? fetch
  const shared = nativeRootCoordinator(root),
    pins = shared.pins
  const specFor = (engine: MusicEngine) => {
    const spec = specs[engine]
    if (!spec || !/^[\w.-]+$/.test(spec.resourceVersion)) throw new Error('Unknown resource engine')
    return spec
  }
  const destination = (engine: MusicEngine) =>
    join(root, 'resources', specFor(engine).resourceVersion)
  const assetUrl = (spec: MusicResourceSpec, name: string) =>
    (options.assetUrl ?? resourceUrl)(spec, name)
  const manifest = async (engine: MusicEngine, signal?: AbortSignal) => {
    const spec = specFor(engine),
      response = await fetcher(assetUrl(spec, manifestName(spec)), {
        signal: signal ?? null,
        redirect: 'follow'
      })
    if (!response.ok || !response.body) throw new Error('Resource manifest unavailable')
    let size = 0
    const chunks = []
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > 1024 * 1024) throw new Error('Resource manifest too large')
      chunks.push(chunk)
    }
    return validateMusicManifest(Buffer.concat(chunks), spec, musicComponentNames[engine])
  }
  const status = async (engine: MusicEngine) => {
    try {
      const installed = JSON.parse(
        await readFile(join(destination(engine), '.registered.json'), 'utf8')
      )
      await (options.verifyReady ?? verifyMusicReadiness)(
        destination(engine),
        engine,
        specFor(engine),
        musicComponentNames[engine]
      )
      return {
        installed: installed.resourceVersion === specFor(engine).resourceVersion,
        directory: destination(engine),
        pinned: !!pins.get(engine)
      }
    } catch {
      return { installed: false, directory: destination(engine), pinned: !!pins.get(engine) }
    }
  }
  const install = async (engine: MusicEngine, control: Control = {}, offline?: string) => {
    if (shared.busy || pins.get(engine)) throw new Error('Music resources are in use')
    shared.busy = true
    const signal = control.signal ?? new AbortController().signal,
      spec = specFor(engine)
    const stage = join(root, '.resource-stage-' + randomUUID()),
      cache = join(root, '.resource-downloads', spec.resourceVersion)
    try {
      signal.throwIfAborted()
      await mkdir(root, { recursive: true })
      if ((await status(engine)).installed) return status(engine)
      const metadata = offline
        ? validateMusicManifest(
            await readFile(join(offline, manifestName(spec))),
            spec,
            musicComponentNames[engine]
          )
        : await manifest(engine, signal)
      const total = Object.values(metadata.components).reduce(
        (sum, c) => sum + c.parts.reduce((sum, p) => sum + p.bytes, 0),
        0
      )
      let downloaded = 0
      await mkdir(stage)
      await mkdir(cache, { recursive: true })
      for (const [name, component] of Object.entries(metadata.components)) {
        const archive = join(stage, name + '.zip'),
          output = await open(archive, 'wx')
        const archiveHash = createHash('sha256')
        try {
          for (const part of component.parts) {
            signal.throwIfAborted()
            const file = offline ? join(offline, part.name) : join(cache, part.name)
            if (offline) await verifyResource(file, part.bytes, part.sha256)
            else
              await downloadResource(
                assetUrl(spec, part.name),
                file,
                part,
                fetcher,
                signal,
                (bytes) => {
                  downloaded += bytes
                  control.onProgress?.({ phase: 'download', bytes: downloaded, total })
                }
              )
            for await (const chunk of createReadStream(file)) {
              signal.throwIfAborted()
              archiveHash.update(chunk)
              await output.writeFile(chunk)
            }
          }
          await output.sync()
        } finally {
          await output.close()
        }
        if (archiveHash.digest('hex') !== component.sha256)
          throw new Error('Combined archive hash mismatch')
        control.onProgress?.({ phase: 'extract', bytes: downloaded, total })
        await mkdir(join(stage, name))
        await extractMusicZip(archive, join(stage, name), component.unpackedBytes, signal)
        await rm(archive)
        await writeFile(
          join(stage, name, '.installed.json'),
          JSON.stringify({ resourceVersion: spec.resourceVersion, sha256: component.sha256 })
        )
      }
      await (options.verifyReady ?? verifyMusicReadiness)(
        stage,
        engine,
        spec,
        musicComponentNames[engine]
      )
      await writeFile(
        join(stage, '.registered.json'),
        JSON.stringify({ engine, resourceVersion: spec.resourceVersion, manifest: metadata })
      )
      await mkdir(join(root, 'resources'), { recursive: true })
      signal.throwIfAborted()
      const target = destination(engine),
        backup = target + '.replaced-' + randomUUID()
      let replaced = false
      try {
        const stat = await lstat(target)
        if (stat.isSymbolicLink() || !stat.isDirectory())
          throw new Error('Unsafe resource replacement')
        await rename(target, backup)
        replaced = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      try {
        await rename(stage, target)
      } catch (error) {
        if (replaced) await rename(backup, target)
        throw error
      }
      if (replaced) await rm(backup, { recursive: true })
      control.onProgress?.({ phase: 'ready', bytes: total, total })
      return status(engine)
    } finally {
      await rm(stage, { recursive: true, force: true })
      shared.busy = false
    }
  }
  return {
    manifest,
    status,
    install: (engine: MusicEngine, control?: Control) => install(engine, control),
    offline: (engine: MusicEngine, directory: string, control?: Control) =>
      install(engine, control, resolve(directory)),
    pin(engine: MusicEngine) {
      if (shared.busy) throw new Error('Resource installation in progress')
      specFor(engine)
      pins.set(engine, (pins.get(engine) ?? 0) + 1)
      let released = false
      return () => {
        if (!released) {
          released = true
          pins.set(engine, Math.max(0, (pins.get(engine) ?? 1) - 1))
        }
      }
    },
    async remove(engine: MusicEngine) {
      if (shared.busy || pins.get(engine)) throw new Error('Music resources are in use')
      shared.busy = true
      try {
        const target = destination(engine),
          stat = await lstat(target).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return undefined
            throw error
          })
        if (!stat) return
        const actual = await realpath(target),
          managed = await realpath(join(root, 'resources')),
          suffix = relative(managed, actual)
        if (stat.isSymbolicLink() || !suffix || suffix.startsWith('..') || isAbsolute(suffix))
          throw new Error('Unsafe music resource removal')
        await rm(actual, { recursive: true })
      } finally {
        shared.busy = false
      }
    }
  }
}
