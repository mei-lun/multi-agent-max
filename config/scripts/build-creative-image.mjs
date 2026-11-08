import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))
const source = path.join(root, 'packages/creative-image')
const vendor = path.join(root, 'vendor/levelup/baseline-6542241')
const output = path.join(root, '.mam-local/component-packages/creative-image')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const provenance = JSON.parse(await readFile(path.join(vendor, 'provenance.json'), 'utf8'))
const upstream = await readFile(path.join(vendor, 'src/lib/spineMatting.ts'))
const sourceHash = hash(upstream)
const declared = JSON.stringify(provenance)
if (!declared.includes(sourceHash))
  throw new Error('Matting source hash is absent from vendored provenance')
await mkdir(output, { recursive: true })
for (const file of [
  'index.html',
  'style.css',
  'workbench.js',
  'generation.js',
  'mask-editor.js',
  'adaptation-provenance.json'
])
  await copyFile(path.join(source, file), path.join(output, file))
await writeFile(
  path.join(output, 'matting.js'),
  ts.transpileModule(upstream.toString(), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
  }).outputText
)
await writeFile(
  path.join(output, 'provenance.json'),
  JSON.stringify(
    {
      commit: provenance.commit,
      source: 'src/lib/spineMatting.ts',
      sha256: sourceHash,
      transformation: 'TypeScript transpileModule ES2022; original vendor source unchanged',
      adaptations: {
        upstream: {
          file: 'src/components/MediaStudio.tsx',
          sha256: hash(await readFile(path.join(vendor, 'src/components/MediaStudio.tsx')))
        },
        modules: Object.fromEntries(
          await Promise.all(
            ['generation.js', 'mask-editor.js'].map(async (file) => [
              file,
              hash(await readFile(path.join(source, file)))
            ])
          )
        ),
        mapping: JSON.parse(await readFile(path.join(source, 'adaptation-provenance.json'), 'utf8'))
      }
    },
    null,
    2
  )
)
const files = {}
for (const file of [
  'index.html',
  'style.css',
  'workbench.js',
  'generation.js',
  'mask-editor.js',
  'adaptation-provenance.json',
  'matting.js',
  'provenance.json'
])
  files[file] = hash(await readFile(path.join(output, file)))
const manifest = {
  id: 'creative.image',
  version: '0.2.0',
  hostApiVersion: '1.0.0',
  minimumHostVersion: '0.1.41',
  platforms: ['darwin', 'linux', 'win32'].flatMap((os) =>
    ['arm64', 'x64'].map((arch) => ({ os, arch }))
  ),
  source: { commit: provenance.commit, sha256: sourceHash },
  files,
  uiEntrypoint: 'index.html',
  runtimeEntrypoint: 'matting.js',
  dependencies: [],
  resources: [],
  operations: [
    {
      id: 'image.generate',
      title: 'Generate images',
      description: 'Host model image generation',
      requiredCapabilities: []
    },
    {
      id: 'image.edit',
      title: 'Edit images',
      description: 'Host reference and mask image editing',
      requiredCapabilities: []
    },
    {
      id: 'image.removeSolidBackground',
      title: '图片预处理',
      description:
        'browser-local: remove edge-connected solid background; PNG export; no cloud or AI generation',
      requiredCapabilities: []
    }
  ]
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
await (await import('./build-creative-runtime.mjs')).buildCreativeRuntime(output)
console.log(output)
