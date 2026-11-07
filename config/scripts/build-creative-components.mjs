import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url)),
  require = createRequire(import.meta.url)
const release = path.join(root, 'release/creative-components/0.1.42'),
  local = path.join(root, '.mam-local/component-packages')
const kinds = ['image', 'video', 'speech', 'writing', 'spine', 'music', 'model3d', 'constellation']
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
await mkdir(release, { recursive: true })
for (const kind of kinds) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(root, `config/scripts/build-creative-${kind}.mjs`)],
      { cwd: root, stdio: 'inherit', windowsHide: true }
    )
    child.once('error', reject)
    child.once('exit', resolve)
  })
  if (code !== 0) throw Error(`Component build failed: ${kind}`)
}
const schemaFile = path.join(root, '.mam-local/component-manifest-schema.mjs')
await build({
  entryPoints: [path.join(root, 'src/shared/mam/components/index.ts')],
  outfile: schemaFile,
  bundle: true,
  platform: 'node',
  format: 'esm'
})
const { componentManifestSchema } = await import(pathToFileURL(schemaFile).href)
const notices = []
for (const name of [
  'react',
  'react-dom',
  'scheduler',
  '@xyflow/react',
  '@xyflow/system',
  'lucide-react',
  'zustand',
  'use-sync-external-store'
]) {
  let directory
  try {
    directory = path.dirname(require.resolve(`${name}/package.json`))
  } catch {
    try {
      directory = path.dirname(require.resolve(name))
      while (
        !JSON.parse(
          await readFile(path.join(directory, 'package.json'), 'utf8').catch(() => '{"name":""}')
        ).name
      )
        directory = path.dirname(directory)
    } catch {
      continue
    }
  }
  const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
  const license = (await readdir(directory)).find((name) =>
    /^licen[sc]e(?:\.md|\.txt)?$/i.test(name)
  )
  if (!license) throw Error(`Missing third-party license: ${name}`)
  notices.push(
    `## ${metadata.name} ${metadata.version}\nLicense: ${metadata.license || 'see text'}\n\n${await readFile(path.join(directory, license), 'utf8')}`
  )
}
const thirdParty = `# Bundled runtime attribution\n\nThis local candidate includes these libraries where used by its UI bundle. No model weights are included. Original model-viewer attribution is supplied separately by creative-model3d.\n\n${notices.join('\n\n')}`
const entries = []
for (const kind of kinds) {
  const source = path.join(local, `creative-${kind}`),
    target = path.join(release, `creative-${kind}`)
  const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'))
  if (
    manifest.minimumHostVersion
      .split('.')
      .map(Number)
      .some(
        (n, i) =>
          n > [0, 1, 42][i] &&
          manifest.minimumHostVersion
            .split('.')
            .map(Number)
            .slice(0, i)
            .every((m, j) => m === [0, 1, 42][j])
      )
  )
    throw Error(`Host version too new: ${kind}`)
  for (const file of ['LICENSE', 'LICENSE.GPL']) {
    await copyFile(
      path.join(root, 'vendor/levelup/baseline-6542241', file),
      path.join(source, file)
    )
    manifest.files[file] = sha(await readFile(path.join(source, file)))
  }
  await writeFile(path.join(source, 'THIRD-PARTY-NOTICES.md'), thirdParty)
  manifest.files['THIRD-PARTY-NOTICES.md'] = sha(
    await readFile(path.join(source, 'THIRD-PARTY-NOTICES.md'))
  )
  componentManifestSchema.parse(manifest)
  for (const file of Object.keys(manifest.files).filter((file) => /\.m?js$/.test(file))) {
    const script = ts.createSourceFile(
      file,
      await readFile(path.join(source, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    )
    function visit(node) {
      const literal =
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? node.moduleSpecifier
          : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
            ? node.arguments[0]
            : undefined
      if (literal && ts.isStringLiteral(literal)) {
        const value = literal.text
        if (!value.startsWith('.') && !value.startsWith('/'))
          throw Error(`Unmapped bare runtime import ${kind}/${file}: ${value}`)
        const target = value.startsWith('/')
          ? value.slice(1)
          : path.posix.normalize(path.posix.join(path.posix.dirname(file), value))
        if (!manifest.files[target])
          throw Error(`Missing runtime import ${kind}/${file}: ${target}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(script)
  }
  await mkdir(target, { recursive: true })
  let bytes = 0
  for (const [file, expected] of Object.entries(manifest.files)) {
    const data = await readFile(path.join(source, file))
    if (sha(data) !== expected) throw Error(`Integrity mismatch: ${kind}/${file}`)
    bytes += data.length
    await mkdir(path.dirname(path.join(target, file)), { recursive: true })
    await writeFile(path.join(target, file), data)
  }
  const encoded = JSON.stringify(manifest, null, 2)
  await writeFile(path.join(source, 'manifest.json'), encoded)
  await writeFile(path.join(target, 'manifest.json'), encoded)
  entries.push({
    path: `creative-${kind}`,
    id: manifest.id,
    version: manifest.version,
    minimumHostVersion: manifest.minimumHostVersion,
    manifestSha256: sha(Buffer.from(encoded)),
    bytes,
    files: Object.keys(manifest.files).length
  })
}
const catalog = {
  schemaVersion: 1,
  distribution: 'unsigned-local',
  hostVersion: '0.1.42',
  signature: null,
  entries
}
await writeFile(path.join(release, 'catalog.json'), JSON.stringify(catalog, null, 2))
await copyFile(path.join(root, 'packages/INSTALL.zh-CN.md'), path.join(release, 'INSTALL.zh-CN.md'))
await writeFile(
  path.join(root, 'release/start-creative-preview.cmd'),
  [
    '@echo off',
    'setlocal',
    'set "MAM_CREATIVE_PREVIEW_DATA=%LOCALAPPDATA%\\MultiAgentMax-CreativePreview"',
    'start "" "%~dp0win-unpacked\\Multi-Agent Max.exe"',
    'endlocal',
    ''
  ].join('\r\n')
)
await writeFile(
  path.join(release, 'COMPATIBILITY.md'),
  `# Compatibility\n\nLocal unsigned candidate; MAM0.1.42 required. Windows x64 native QA is the current evidence; platform entries do not certify other-platform GPU tools.\n\n| Component | Version | Minimum host | Manifest SHA-256 |\n|---|---|---|---|\n${entries.map((e) => `| ${e.id} | ${e.version} | ${e.minimumHostVersion} | ${e.manifestSha256} |`).join('\n')}\n\nOffline editing is available for writing/spine/constellation. Image/video/speech and AI writing require configured model profiles. Music/3D require separately installed native resources and suitable hardware. RIFE/ComfyUI require separately configured local installations. No weights, credentials, signatures, or provider endpoints are bundled. See each package provenance.json for source input hashes.\n`
)
console.log(
  JSON.stringify(
    {
      directory: release,
      packages: entries.length,
      bytes: entries.reduce((sum, e) => sum + e.bytes, 0),
      catalog: 'catalog.json'
    },
    null,
    2
  )
)
