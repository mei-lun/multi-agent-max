import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = fileURLToPath(new URL('../../', import.meta.url))
const source = path.join(root, 'packages/creative-video'),
  output = path.join(root, '.mam-local/component-packages/creative-video')
const vendor = path.join(root, 'vendor/levelup/baseline-6542241')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const provenance = JSON.parse(await readFile(path.join(vendor, 'provenance.json'), 'utf8'))
const upstreamHash = hash(await readFile(path.join(vendor, 'src/components/MediaStudio.tsx')))
if (!JSON.stringify(provenance).includes(upstreamHash))
  throw new Error('Missing vendored MediaStudio provenance')
await mkdir(output, { recursive: true })
const files = {}
for (const file of ['index.html', 'style.css', 'workbench.js', 'adaptation-provenance.json']) {
  await copyFile(path.join(source, file), path.join(output, file))
  files[file] = hash(await readFile(path.join(output, file)))
}
await writeFile(
  path.join(output, 'provenance.json'),
  JSON.stringify(
    {
      commit: provenance.commit,
      source: 'src/components/MediaStudio.tsx',
      sha256: upstreamHash,
      adaptation: JSON.parse(
        await readFile(path.join(source, 'adaptation-provenance.json'), 'utf8')
      )
    },
    null,
    2
  )
)
files['provenance.json'] = hash(await readFile(path.join(output, 'provenance.json')))
await writeFile(
  path.join(output, 'manifest.json'),
  JSON.stringify(
    {
      id: 'creative.video',
      version: '0.1.0',
      hostApiVersion: '1.0.0',
      minimumHostVersion: '0.1.42',
      platforms: ['darwin', 'linux', 'win32'].flatMap((os) =>
        ['arm64', 'x64'].map((arch) => ({ os, arch }))
      ),
      source: { commit: provenance.commit, sha256: upstreamHash },
      files,
      uiEntrypoint: 'index.html',
      runtimeEntrypoint: 'workbench.js',
      dependencies: [],
      resources: [],
      operations: ['video.generate', 'video.edit', 'video.refresh'].map((id) => ({
        id,
        title: id,
        description: 'Host-owned video task workflow',
        requiredCapabilities: []
      }))
    },
    null,
    2
  )
)
console.log(output)
