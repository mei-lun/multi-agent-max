import { build } from 'esbuild'
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = fileURLToPath(new URL('../../', import.meta.url)),
  source = path.join(root, 'packages/creative-model3d'),
  output = path.join(root, '.mam-local/component-packages/creative-model3d'),
  vendor = path.join(root, 'vendor/levelup/baseline-6542241'),
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
await mkdir(output, { recursive: true })
const pinned = JSON.parse(await readFile(path.join(vendor, 'provenance.json'), 'utf8')),
  declared = new Map()
function index(value) {
  if (value && typeof value === 'object') {
    if (value.path && value.sha256) declared.set(value.path, value.sha256)
    Object.values(value).forEach(index)
  }
}
index(pinned)
const inputs = []
for (const file of [
  'src/components/ModelWorkbench.tsx',
  'src/components/ModelWorkbench.css',
  'src/lib/modelWorkbench.ts'
]) {
  const sha256 = hash(await readFile(path.join(vendor, file)))
  if (declared.get(file) !== sha256) throw Error(`Pinned source mismatch ${file}`)
  inputs.push({ file, sha256 })
}
await build({
  entryPoints: [path.join(source, 'entry.tsx')],
  outfile: path.join(output, 'model3d.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'mam-adapters',
      setup(b) {
        b.onResolve({ filter: /@tauri-apps\// }, () => ({ path: path.join(source, 'host.ts') }))
        b.onResolve({ filter: /\/(bridge|i18n)$/ }, () => ({ path: path.join(source, 'host.ts') }))
        b.onResolve({ filter: /\/CreativeStudioHeader$/ }, () => ({
          path: path.join(source, 'header.tsx')
        }))
        b.onResolve({ filter: /\/ResourceRemovalControl$/ }, () => ({
          path: path.join(source, 'upstream-input/ResourceRemovalControl.tsx')
        }))
      }
    }
  ]
})
await copyFile(path.join(source, 'index.html'), path.join(output, 'index.html'))
await writeFile(
  path.join(output, 'provenance.json'),
  JSON.stringify(
    {
      commit: pinned.commit,
      inputs,
      transformation:
        'Unmodified original ModelWorkbench and modelWorkbench library; Tauri/bridge/header aliases delegate to MAM',
      adapters: await Promise.all(
        [
          'entry.tsx',
          'host.ts',
          'header.tsx',
          'shell.css',
          'upstream-input/ResourceRemovalControl.tsx',
          'upstream-input/ResourceRemovalControl.css'
        ].map(async (file) => ({ file, sha256: hash(await readFile(path.join(source, file))) }))
      )
    },
    null,
    2
  )
)
const files = {}
for (const file of ['index.html', 'model3d.js', 'model3d.css', 'provenance.json'])
  files[file] = hash(await readFile(path.join(output, file)))
await copyFile(path.join(vendor, 'LICENSE'), path.join(output, 'LICENSE'))
files.LICENSE = hash(await readFile(path.join(output, 'LICENSE')))
async function runtime(directory) {
  for (const entry of await readdir(path.join(vendor, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`
    if (entry.isDirectory()) {
      if (!['tests', '__pycache__'].includes(entry.name)) await runtime(file)
    } else if (/\.(py|json)$/.test(entry.name)) {
      const bytes = await readFile(path.join(vendor, file)),
        sha256 = hash(bytes)
      if (declared.get(file) !== sha256) throw Error(`Runtime source mismatch ${file}`)
      await mkdir(path.dirname(path.join(output, file)), { recursive: true })
      await copyFile(path.join(vendor, file), path.join(output, file))
      files[file] = sha256
    }
  }
}
await runtime('modules/model_workbench')
for (const file of ['model-viewer.min.js', 'model-viewer-LICENSE']) {
  await copyFile(path.join(source, 'upstream-input', file), path.join(output, file))
  files[file] = hash(await readFile(path.join(output, file)))
}
await writeFile(
  path.join(output, 'manifest.json'),
  JSON.stringify(
    {
      id: 'creative.model3d',
      version: '0.1.0',
      hostApiVersion: '1.0.0',
      minimumHostVersion: '0.1.42',
      platforms: ['darwin', 'linux', 'win32'].flatMap((os) =>
        ['arm64', 'x64'].map((arch) => ({ os, arch }))
      ),
      source: { commit: pinned.commit, sha256: files['provenance.json'] },
      files,
      uiEntrypoint: 'index.html',
      runtimeEntrypoint: 'model3d.js',
      dependencies: [],
      resources: [],
      operations: [
        'status',
        'import',
        'reference',
        'start',
        'cancel',
        'artifact',
        'export',
        'resources.manifest',
        'resources.install',
        'resources.offline',
        'resources.remove'
      ].map((action) => ({
        id: `model3d.${action}`,
        title: action,
        description: 'Managed native music operation',
        requiredCapabilities: []
      }))
    },
    null,
    2
  )
)
console.log(output)
