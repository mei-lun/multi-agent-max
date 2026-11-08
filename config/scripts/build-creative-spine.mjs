import { build } from 'esbuild'
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = fileURLToPath(new URL('../../', import.meta.url)),
  source = path.join(root, 'packages/creative-spine'),
  output = path.join(root, '.mam-local/component-packages/creative-spine'),
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
for (const dir of ['src/components', 'src/lib'])
  for (const name of await readdir(path.join(vendor, dir)))
    if (/^spine/i.test(name)) {
      const file = `${dir}/${name}`,
        sha256 = hash(await readFile(path.join(vendor, file)))
      if (declared.get(file) !== sha256) throw Error(`Upstream hash mismatch ${file}`)
      inputs.push({ file, sha256 })
    }
await build({
  entryPoints: [path.join(source, 'entry.tsx')],
  outfile: path.join(output, 'spine.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'mam-adapters',
      setup(b) {
        b.onResolve({ filter: /\/spineStorage$/ }, (args) =>
          args.importer.endsWith('storage-adapter.ts')
            ? undefined
            : { path: path.join(source, 'storage-adapter.ts') }
        )
        b.onResolve({ filter: /(?:^|\/)bridge$/ }, () => ({ path: path.join(source, 'bridge.ts') }))
        b.onResolve({ filter: /\/(i18n|modelSelection|CreativeStudioHeader)$/ }, () => ({
          path: path.join(source, 'adapters.tsx')
        }))
        b.onResolve({ filter: /(?:^|\/)spineBridge$/ }, () => ({
          path: path.join(source, 'native-adapter.ts')
        }))
      }
    }
  ]
})
await copyFile(path.join(source, 'index.html'), path.join(output, 'index.html'))
await copyFile(path.join(source, 'spine-render.html'), path.join(output, 'spine-render.html'))
await build({
  entryPoints: [path.join(source, 'spine-render-entry.ts')],
  outfile: path.join(output, 'spine-render-entry.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022'
})
await build({
  entryPoints: [path.join(source, 'runtime-render.ts')],
  outfile: path.join(output, 'spine-render.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022'
})
await writeFile(
  path.join(output, 'provenance.json'),
  JSON.stringify(
    {
      commit: pinned.commit,
      transformation:
        'Original Spine React UI/core bundled unchanged; explicit MAM bridge/header/native adapters',
      inputs,
      adapters: await Promise.all(
        [
          'entry.tsx',
          'bridge.ts',
          'adapters.tsx',
          'native-adapter.ts',
          'shell.css',
          'runtime-business.ts',
          'runtime-render.ts',
          'spine-render.html',
          'spine-render-entry.ts'
        ].map(async (file) => ({ file, sha256: hash(await readFile(path.join(source, file))) }))
      )
    },
    null,
    2
  )
)
const files = {}
for (const file of [
  'index.html',
  'spine.js',
  'spine.css',
  'spine-render.js',
  'spine-render.html',
  'spine-render-entry.js',
  'provenance.json'
])
  files[file] = hash(await readFile(path.join(output, file)))
await writeFile(
  path.join(output, 'manifest.json'),
  JSON.stringify(
    {
      id: 'creative.spine',
      version: '0.1.0',
      hostApiVersion: '1.0.0',
      minimumHostVersion: '0.1.42',
      platforms: ['darwin', 'linux', 'win32'].flatMap((os) =>
        ['arm64', 'x64'].map((arch) => ({ os, arch }))
      ),
      source: { commit: pinned.commit, sha256: files['provenance.json'] },
      files,
      uiEntrypoint: 'index.html',
      runtimeEntrypoint: 'spine.js',
      dependencies: [],
      resources: [],
      operations: [
        'assets.projectMedia',
        'image.generate',
        'image.edit',
        'text.generate',
        'vision.generate',
        'spine.comfy.request',
        'spine.rife.frame',
        'spine.project.normalize',
        'spine.project.compile',
        'spine.pose.capture',
        'spine.pose.fit',
        'spine.animation.generate',
        'spine.image.normalize',
        'spine.export'
      ].map((id) => ({
        id,
        title: id,
        description: 'Host-managed creative generation',
        requiredCapabilities: id === 'assets.projectMedia' ? ['assets.projectMedia'] : []
      }))
    },
    null,
    2
  )
)
await (await import('./build-creative-runtime.mjs')).buildCreativeRuntime(output)
console.log(output)
