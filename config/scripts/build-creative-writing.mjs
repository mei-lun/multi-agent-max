import { build } from 'esbuild'
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = fileURLToPath(new URL('../../', import.meta.url)),
  source = path.join(root, 'packages/creative-writing'),
  output = path.join(root, '.mam-local/component-packages/creative-writing'),
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
const sourcePaths = [
  'src/components/WritingStudio.tsx',
  'src/components/WritingMissionControl.tsx',
  'src/components/WritingStudio.css',
  'src/lib/writing.ts'
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
  outfile: path.join(output, 'writing.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  plugins: [
    {
      name: 'mam-adapters',
      setup(b) {
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
    'src/components/WritingStudio.tsx',
    'src/components/WritingMissionControl.tsx',
    'src/components/WritingStudio.css',
    'src/lib/writing.ts'
  ]
await writeFile(
  path.join(output, 'provenance.json'),
  JSON.stringify(
    {
      commit: '6542241e440dead6cee60440afd8e658dd0ce0ca',
      transformation:
        'Unmodified upstream React UI bundled with esbuild; bridge/i18n/modelSelection/header aliased to explicit MAM adapters',
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
for (const file of ['index.html', 'writing.js', 'writing.css', 'provenance.json'])
  files[file] = hash(await readFile(path.join(output, file)))
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
      id: 'creative.writing',
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
      runtimeEntrypoint: 'writing.js',
      dependencies: [],
      resources: [],
      operations: [
        {
          id: 'text.generate',
          title: '写作文本生成',
          description: 'Host-managed writing generation',
          requiredCapabilities: []
        }
      ]
    },
    null,
    2
  )
)
console.log(output)
