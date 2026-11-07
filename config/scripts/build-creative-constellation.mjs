import { build } from 'esbuild'
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = fileURLToPath(new URL('../../', import.meta.url)),
  source = path.join(root, 'packages/creative-constellation'),
  output = path.join(root, '.mam-local/component-packages/creative-constellation'),
  vendor = path.join(root, 'vendor/levelup/baseline-6542241')
await mkdir(output, { recursive: true })
const pinned = JSON.parse(await readFile(path.join(vendor, 'provenance.json'), 'utf8'))
const declared = new Map()
function index(value) {
  if (value && typeof value === 'object') {
    if (typeof value.path === 'string' && typeof value.sha256 === 'string')
      declared.set(value.path, value.sha256)
    for (const child of Object.values(value)) index(child)
  }
}
index(pinned)
const metadataPlugin = {
  name: 'owned-file-metadata',
  setup(b) {
    b.onLoad({ filter: /[\\/]lib[\\/]constellation\.ts$/ }, async (args) => {
      let contents = await readFile(args.path, 'utf8')
      const marker = '  if (!attachments.length) return {};'
      if (!contents.includes(marker)) throw Error('File output metadata transform anchor changed')
      contents = contents.replace(
        marker,
        marker +
          `\n  if (!text?.trim() && attachments.some(item => item.kind === "file")) text = attachments.map(item => "附件元数据（未解析内容）: " + item.name + ", " + item.mimeType + ", " + item.size + " bytes").join("\\n");`
      )
      return { contents, loader: 'ts' }
    })
  }
}
const sourcePaths = [
  'src/components/ConstellationStudio.tsx',
  'src/components/ConstellationNodes.tsx',
  'src/components/ConstellationStudio.css',
  'src/lib/constellation.ts'
]
for (const file of sourcePaths) {
  const actual = createHash('sha256')
    .update(await readFile(path.join(vendor, file)))
    .digest('hex')
  if (declared.get(file) !== actual)
    throw new Error(`Pinned upstream source hash mismatch: ${file}`)
}
await build({
  entryPoints: [path.join(source, 'entry.tsx')],
  outfile: path.join(output, 'constellation.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  plugins: [
    metadataPlugin,
    {
      name: 'mam-adapters',
      setup(b) {
        b.onResolve({ filter: /@tauri-apps\/api\/window/ }, () => ({
          path: path.join(source, 'adapters.tsx')
        }))
        b.onResolve(
          { filter: /\/(canvasEditorState|useImageCopy|clipboard|AttachmentChip|IconButton)$/ },
          (args) => ({
            path: path.join(
              source,
              'upstream-input',
              args.path.split('/').at(-1) +
                (['AttachmentChip', 'IconButton', 'useImageCopy'].includes(
                  args.path.split('/').at(-1)
                )
                  ? '.tsx'
                  : ' .ts'
                ).trim()
            )
          })
        )
        b.onResolve({ filter: /\/lib\/(bridge|i18n|modelSelection)$/ }, (args) => ({
          path: path.join(source, args.path.endsWith('bridge') ? 'bridge.ts' : 'adapters.tsx')
        }))
        b.onResolve({ filter: /\/CreativeStudioHeader$/ }, () => ({
          path: path.join(source, 'adapters.tsx')
        }))
      }
    }
  ]
})
await copyFile(path.join(source, 'index.html'), path.join(output, 'index.html'))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  inputs = [
    'src/components/ConstellationStudio.tsx',
    'src/components/ConstellationNodes.tsx',
    'src/components/ConstellationStudio.css',
    'src/lib/constellation.ts'
  ]
await writeFile(
  path.join(output, 'provenance.json'),
  JSON.stringify(
    {
      commit: '6542241e440dead6cee60440afd8e658dd0ce0ca',
      transformation:
        'Upstream React UI plus explicit MAM adapters; anchored constellationFileOutputs metadata-only text transform for generic files. No upstream file edits.',
      inputs: await Promise.all(
        inputs.map(async (file) => ({
          file,
          sha256: hash(await readFile(path.join(vendor, file)))
        }))
      )
    },
    null,
    2
  )
)
const files = {}
for (const file of ['index.html', 'constellation.js', 'constellation.css', 'provenance.json'])
  files[file] = hash(await readFile(path.join(output, file)))
const missing = JSON.parse(
  await readFile(path.join(source, 'upstream-input/manifest.json'), 'utf8')
)
for (const item of missing) {
  if (hash(await readFile(path.join(source, 'upstream-input', item.file))) !== item.sha256)
    throw Error(`Missing dependency hash mismatch ${item.file}`)
}
await writeFile(path.join(output, 'upstream-input-manifest.json'), JSON.stringify(missing, null, 2))
files['upstream-input-manifest.json'] = hash(
  await readFile(path.join(output, 'upstream-input-manifest.json'))
)
await copyFile(path.join(vendor, 'LICENSE'), path.join(output, 'LICENSE'))
files.LICENSE = hash(await readFile(path.join(output, 'LICENSE')))
const provenance = JSON.parse(await readFile(path.join(output, 'provenance.json'), 'utf8'))
provenance.adapters = await Promise.all(
  ['bridge.ts', 'adapters.tsx', 'entry.tsx', 'shell.css', 'index.html'].map(async (file) => ({
    file,
    sha256: hash(await readFile(path.join(source, file)))
  }))
)
await writeFile(path.join(output, 'provenance.json'), JSON.stringify(provenance, null, 2))
files['provenance.json'] = hash(await readFile(path.join(output, 'provenance.json')))
await writeFile(
  path.join(output, 'manifest.json'),
  JSON.stringify(
    {
      id: 'creative.constellation',
      version: '0.1.0',
      hostApiVersion: '1.0.0',
      minimumHostVersion: '0.1.42',
      platforms: ['darwin', 'linux', 'win32'].flatMap((os) =>
        ['arm64', 'x64'].map((arch) => ({ os, arch }))
      ),
      source: {
        commit: '6542241e440dead6cee60440afd8e658dd0ce0ca',
        sha256: files['provenance.json']
      },
      files,
      uiEntrypoint: 'index.html',
      runtimeEntrypoint: 'constellation.js',
      dependencies: [],
      resources: [],
      operations: [
        {
          id: 'tool.execute',
          title: '授权本地工具',
          description: 'Manual permission scoped tools',
          requiredCapabilities: ['tools.manual']
        },
        'text.generate',
        'vision.generate',
        'image.generate',
        'image.edit',
        'video.generate',
        'speech.generate'
      ].map((id) =>
        typeof id === 'string'
          ? { id, title: id, description: 'Scoped host creation', requiredCapabilities: [] }
          : id
      )
    },
    null,
    2
  )
)
console.log(output)
