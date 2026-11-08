import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { constellationFilePortsPlugin } from './creative-constellation-source-patches.mjs'
const root = fileURLToPath(new URL('../../', import.meta.url))
export async function buildCreativeRuntime(directory) {
  const outfile = path.join(directory, 'backend.cjs')
  const result = await build({
    entryPoints: [path.join(root, 'packages/runtime/entry.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    metafile: true,
    plugins: [
      constellationFilePortsPlugin,
      {
        name: 'package-host-boundary',
        setup(builder) {
          builder.onResolve({ filter: /^electron$/ }, () => ({
            path: path.join(root, 'packages/runtime/capabilities.ts')
          }))
          builder.onResolve({ filter: /^node:child_process$/ }, () => ({
            path: path.join(root, 'packages/runtime/native-process.ts')
          }))
          builder.onResolve({ filter: /components\/host-native-assets$/ }, () => ({
            path: path.join(root, 'packages/runtime/image-inspection.ts')
          }))
        }
      }
    ]
  })
  const manifestPath = path.join(directory, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
  const inputs = Object.fromEntries(
    await Promise.all(
      Object.keys(result.metafile.inputs).map(async (file) => [
        file,
        hash(await readFile(path.resolve(root, file)))
      ])
    )
  )
  await writeFile(
    path.join(directory, 'backend-provenance.json'),
    JSON.stringify(
      {
        hostApiVersion: '2.0.0',
        inputs,
        transforms: {
          'config/scripts/creative-constellation-source-patches.mjs': hash(
            await readFile(
              path.join(root, 'config/scripts/creative-constellation-source-patches.mjs')
            )
          )
        }
      },
      null,
      2
    )
  )
  manifest.runtimeEntrypoint = 'backend.cjs'
  manifest.hostApiVersion = '2.0.0'
  manifest.minimumHostVersion = '0.1.43'
  manifest.version = '0.3.0'
  const businessOperations =
    manifest.id === 'creative.writing'
      ? ['writing.goal.plan', 'writing.goal.execute', 'writing.project.export']
      : manifest.id === 'creative.constellation'
        ? ['constellation.graph.execute']
        : []
  for (const id of businessOperations)
    if (!manifest.operations.some((operation) => operation.id === id))
      manifest.operations.push({
        id,
        title: id,
        description: 'Package-owned background business operation',
        requiredCapabilities: []
      })
  for (const file of ['backend.cjs', 'backend-provenance.json'])
    manifest.files[file] = hash(await readFile(path.join(directory, file)))
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
}
