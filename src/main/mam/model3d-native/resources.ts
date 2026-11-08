import { mkdir, readFile, writeFile, rename, rm, open, lstat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { model3dManifest, model3dResourceSpec as spec } from '../../../shared/mam/model3d-native'
import { downloadResource, verifyResource } from '../music-native/resources/download'
import { extractMusicZip } from '../music-native/resources/zip'
import { recoverResources } from './resource-recovery'
export const names = ['runtime', 'triposg', 'texture', 'blender'] as const
const required: Record<string, string[]> = {
  runtime: [
    'python/python.exe',
    'vendor/TripoSG/triposg/pipelines/pipeline_triposg.py',
    'vendor/MV-Adapter/mvadapter/__init__.py'
  ],
  triposg: ['model_index.json'],
  texture: ['base/model_index.json', 'adapter/mvadapter_ig2mv_sd21.safetensors', 'provenance.json'],
  blender: ['blender.exe']
}
export const manifestFile = `model-workbench-${spec.resourceVersion}-${spec.target}.json`
export function validateModel3dManifest(bytes: Buffer) {
  if (bytes.length > 1024 * 1024) throw new Error('3D manifest too large')
  const value = model3dManifest.parse(JSON.parse(bytes.toString()))
  if (Object.keys(value.components).length !== 4 || names.some((name) => !value.components[name]))
    throw new Error('Missing 3D component')
  for (const [name, component] of Object.entries(value.components))
    component.parts.forEach((part, index) => {
      if (
        part.name !==
        `model-workbench-${spec.resourceVersion}-${spec.target}-${name}.zip.part${String(index + 1).padStart(3, '0')}`
      )
        throw new Error('Invalid 3D resource part')
    })
  return value
}
export function model3dResources(root: string, fetcher: typeof fetch = fetch) {
  const directory = join(root, 'resources', spec.resourceVersion, spec.target)
  const url = (name: string) =>
    `https://github.com/TippingGame/LevelUpAgent/releases/download/${spec.releaseTag}/${name}`
  const manifest = async (signal: AbortSignal) => {
    const response = await fetcher(url(manifestFile), { signal })
    if (!response.ok || !response.body) throw new Error('3D manifest unavailable')
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > 1024 * 1024) throw new Error('3D manifest too large')
      chunks.push(chunk)
    }
    return validateModel3dManifest(Buffer.concat(chunks))
  }
  const installed = async () => {
    try {
      const value = validateModel3dManifest(await readFile(join(directory, 'manifest.json')))
      const result: Record<string, boolean> = {}
      const required: Record<string, string[]> = {
        runtime: [
          'python/python.exe',
          'vendor/TripoSG/triposg/pipelines/pipeline_triposg.py',
          'vendor/MV-Adapter/mvadapter/__init__.py'
        ],
        triposg: ['model_index.json'],
        texture: [
          'base/model_index.json',
          'adapter/mvadapter_ig2mv_sd21.safetensors',
          'provenance.json'
        ],
        blender: ['blender.exe']
      }
      for (const name of names) {
        try {
          const marker = JSON.parse(
            await readFile(join(directory, name, '.installed.json'), 'utf8')
          )
          result[name] =
            marker.sha256 === value.components[name]!.sha256 &&
            marker.resourceVersion === spec.resourceVersion &&
            marker.target === spec.target
          for (const file of required[name]!)
            if (!(await lstat(join(directory, name, file))).isFile()) result[name] = false
        } catch {
          result[name] = false
        }
      }
      return result
    } catch {
      return Object.fromEntries(names.map((name) => [name, false]))
    }
  }
  return {
    directory,
    manifest,
    installed,
    async install(
      selected: string[],
      signal: AbortSignal,
      emit: (value: unknown) => Promise<void>,
      offline?: string
    ) {
      if (
        !selected.length ||
        selected.some((name) => !names.includes(name as (typeof names)[number]))
      )
        throw new Error('Invalid 3D resource selection')
      const metadata = offline
        ? validateModel3dManifest(await readFile(join(offline, manifestFile)))
        : await manifest(signal)
      await mkdir(directory, { recursive: true })
      await recoverResources(directory)
      let committed = await readFile(join(directory, 'manifest.json'))
        .then(validateModel3dManifest)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
          return metadata
        })
      const cache = join(root, '.3d-downloads')
      await mkdir(cache, { recursive: true })
      const totalBytes = selected.reduce(
        (sum, name) =>
          sum + metadata.components[name]!.parts.reduce((n, part) => n + part.bytes, 0),
        0
      )
      let downloadedBytes = 0,
        progressWrites = Promise.resolve()
      for (const name of new Set(selected)) {
        const component = metadata.components[name]!,
          stage = join(directory, '.stage-' + randomUUID()),
          archive = join(cache, name + '.zip')
        try {
          await mkdir(stage)
          const output = await open(archive, 'w'),
            hash = createHash('sha256')
          try {
            for (const part of component.parts) {
              const file = offline ? join(offline, part.name) : join(cache, part.name)
              if (offline) await verifyResource(file, part.bytes, part.sha256)
              else
                await downloadResource(url(part.name), file, part, fetcher, signal, (bytes) => {
                  downloadedBytes += bytes
                  const value = {
                    phase: 'download',
                    downloadedBytes,
                    totalBytes,
                    progress: downloadedBytes / totalBytes,
                    detail: part.name,
                    component: name
                  }
                  progressWrites = progressWrites.then(() => emit(value))
                })
              await progressWrites
              for await (const chunk of createReadStream(file)) {
                signal.throwIfAborted()
                hash.update(chunk)
                await output.writeFile(chunk)
              }
            }
          } finally {
            await output.close()
          }
          if (hash.digest('hex') !== component.sha256)
            throw new Error('3D archive checksum mismatch')
          await extractMusicZip(archive, stage, component.unpackedBytes, signal)
          await emit({ phase: 'extract', downloadedBytes, totalBytes, detail: name })
          for (const file of required[name]!) {
            const stat = await lstat(join(stage, file))
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Incomplete 3D component')
          }
          await writeFile(
            join(stage, '.installed.json'),
            JSON.stringify({
              resourceVersion: spec.resourceVersion,
              target: spec.target,
              sha256: component.sha256
            })
          )
          signal.throwIfAborted()
          const target = join(directory, name),
            backup = target + '.old-' + randomUUID()
          let replaced = false
          try {
            const stat = await lstat(target)
            if (stat.isSymbolicLink()) throw new Error('Unsafe 3D resource')
            await rename(target, backup)
            replaced = true
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          }
          try {
            await rename(stage, target)
            // Register each completed resource before proceeding to the next download.
            // A failed later archive must not leave the completed component unregistered.
            const manifestStage = join(directory, '.manifest-' + randomUUID())
            const next = {
              ...committed,
              components: { ...committed.components, [name]: component }
            }
            await writeFile(manifestStage, JSON.stringify(next))
            await rename(manifestStage, join(directory, 'manifest.json'))
            committed = next
          } catch (error) {
            await rm(target, { recursive: true, force: true })
            if (replaced) await rename(backup, target)
            throw error
          }
          if (replaced) await rm(backup, { recursive: true })
        } finally {
          await rm(stage, { recursive: true, force: true })
          await rm(archive, { force: true })
        }
      }
      return installed()
    }
  }
}
