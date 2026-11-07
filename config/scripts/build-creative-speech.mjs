import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = fileURLToPath(new URL('../../', import.meta.url)),
  source = path.join(root, 'packages/creative-speech'),
  output = path.join(root, '.mam-local/component-packages/creative-speech'),
  vendor = path.join(root, 'vendor/levelup/baseline-6542241')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
await mkdir(output, { recursive: true })
const upstream = await Promise.all(
  ['src/components/MediaStudio.tsx', 'src-tauri/src/media.rs'].map(async (file) => ({
    file,
    sha256: hash(await readFile(path.join(vendor, file)))
  }))
)
const provenance = {
  upstream,
  adaptation:
    'Independent speech workflow UI retaining MediaStudio model selection, text/voice generation and MediaAssetCard reuse/export semantics; media.rs provider speech generation delegated to MAM host; no original code copied.',
  authored: { file: 'speech.js', sha256: hash(await readFile(path.join(source, 'speech.js'))) }
}
await writeFile(path.join(output, 'provenance.json'), JSON.stringify(provenance, null, 2))
const files = {}
for (const file of ['index.html', 'style.css', 'speech.js']) {
  await copyFile(path.join(source, file), path.join(output, file))
  files[file] = hash(await readFile(path.join(output, file)))
}
files['provenance.json'] = hash(await readFile(path.join(output, 'provenance.json')))
const manifest = {
  id: 'creative.speech',
  version: '0.1.0',
  hostApiVersion: '1.0.0',
  minimumHostVersion: '0.1.41',
  platforms: ['darwin', 'linux', 'win32'].flatMap((os) =>
    ['arm64', 'x64'].map((arch) => ({ os, arch }))
  ),
  source: {
    commit: JSON.parse(await readFile(path.join(vendor, 'provenance.json'), 'utf8')).commit,
    sha256: upstream[0].sha256
  },
  files,
  uiEntrypoint: 'index.html',
  runtimeEntrypoint: 'speech.js',
  dependencies: [],
  resources: [],
  operations: [
    {
      id: 'speech.generate',
      title: '生成语音',
      description: 'Host-managed speech synthesis',
      requiredCapabilities: []
    }
  ]
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(output)
