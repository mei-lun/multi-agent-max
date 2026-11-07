import { readFile, writeFile, mkdir, lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import type { BinaryAssetStore } from '../creative-runtime/assets'
import type { CreativeRequest } from '../../../shared/mam/creative-runtime'
import { assertAncestors } from '../components/registry/persistence'
import { model3dId } from '../../../shared/mam/model3d-native'
export const scopeDirectory = (root: string, request: CreativeRequest) =>
  join(
    root,
    'projects-scoped',
    createHash('sha256')
      .update(JSON.stringify([request.projectId, request.componentId]))
      .digest('hex')
  )
export async function projectRecord(data: string, id: string) {
  model3dId.parse(id)
  const file = join(data, 'projects', id, 'project.json')
  await assertAncestors(file)
  const value = JSON.parse(await readFile(file, 'utf8'))
  if (value.id !== id) throw new Error('Invalid project identity')
  return value
}
export async function listProjects(data: string) {
  const ids = await readdir(join(data, 'projects')).catch(() => [])
  const projects = []
  for (const id of ids) if (/^[a-f0-9]{32}$/.test(id)) projects.push(await projectRecord(data, id))
  return projects.sort((a, b) => b.updatedAt - a.updatedAt)
}
export async function importProject(
  data: string,
  request: CreativeRequest,
  assets: BinaryAssetStore,
  decode: (bytes: Buffer) => string,
  reference = false
) {
  if (request.inputAssets.length !== 1 || request.inputAssets[0]!.bytes > 16 * 1024 * 1024)
    throw new Error('3D requires one bounded image')
  const ref = request.inputAssets[0]!,
    bytes = await assets.read(ref),
    mime = decode(bytes)
  if (!['image/png', 'image/jpeg'].includes(mime) || (reference && mime !== 'image/png'))
    throw new Error('Invalid 3D source format')
  const id = reference
      ? model3dId.parse(request.params.projectId)
      : randomUUID().replaceAll('-', ''),
    directory = join(data, 'projects', id)
  const project = reference
    ? await projectRecord(data, id)
    : { id, name: ref.filename, updatedAt: Date.now() / 1000, stages: {} }
  await mkdir(directory, { recursive: true })
  if (reference) {
    const filename = `reference-${randomUUID().replaceAll('-', '')}.png`
    await writeFile(join(directory, filename), bytes, { flag: 'wx' })
    project.reference = { file: filename }
  } else await writeFile(join(directory, 'input.png'), bytes, { flag: 'wx' })
  project.updatedAt = Date.now() / 1000
  await writeFile(join(directory, 'project.json'), JSON.stringify(project))
  return project
}
export async function projectArtifact(
  data: string,
  params: Record<string, unknown>,
  assets: BinaryAssetStore
) {
  const project = await projectRecord(data, String(params.projectId)),
    stage = String(params.stage ?? 'shape')
  const filename = String(params.name ?? 'model.glb')
  if (
    ![
      'input.png',
      'reference.png',
      'model.glb',
      'basecolor.png',
      'delivery.zip',
      'validation.json',
      'character.blend',
      'character.fbx'
    ].includes(filename)
  )
    throw new Error('Invalid 3D artifact name')
  if (!['input', 'shape', 'texture', 'rig'].includes(stage)) throw new Error('Invalid 3D stage')
  const record = project.stages?.[stage]
  if (stage !== 'input' && (!record || !/^runs\/[a-f0-9]{32}$/.test(record.directory)))
    throw new Error('3D stage unavailable')
  if (stage === 'input' && !['input.png', 'reference.png'].includes(filename))
    throw new Error('Invalid input artifact')
  const source = filename === 'reference.png' ? (project.reference?.file ?? 'input.png') : filename
  if (filename === 'reference.png' && !/^(input\.png|reference-[a-f0-9]{32}\.png)$/.test(source))
    throw new Error('Invalid reference artifact')
  const file = join(
    data,
    'projects',
    project.id,
    ...(stage === 'input' ? [source] : [record.directory, filename])
  )
  await assertAncestors(file)
  const stat = await lstat(file)
  if (!stat.isFile() || stat.size > 512 * 1024 * 1024) throw new Error('Invalid 3D artifact')
  const bytes = await readFile(file)
  if (
    filename.endsWith('.glb')
      ? bytes.toString('ascii', 0, 4) !== 'glTF' ||
        bytes.readUInt32LE(4) !== 2 ||
        bytes.readUInt32LE(8) !== bytes.length
      : filename.endsWith('.fbx')
        ? !bytes.toString('ascii', 0, 23).startsWith('Kaydara FBX Binary')
        : filename.endsWith('.zip')
          ? bytes.readUInt32LE(0) !== 0x04034b50
          : filename.endsWith('.png')
            ? !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : filename.endsWith('.blend')
              ? bytes.toString('ascii', 0, 7) !== 'BLENDER'
              : filename.endsWith('.json')
                ? !JSON.parse(bytes.toString())
                : false
  )
    throw new Error('Invalid 3D container')
  const ref = await assets.import(
    (async function* () {
      yield bytes
    })(),
    {
      filename,
      mime: filename.endsWith('.glb')
        ? 'model/gltf-binary'
        : filename.endsWith('.fbx')
          ? 'application/octet-stream'
          : filename.endsWith('.png')
            ? 'image/png'
            : filename.endsWith('.json')
              ? 'application/json'
              : filename.endsWith('.zip')
                ? 'application/zip'
                : 'application/octet-stream'
    }
  )
  return ref
}
