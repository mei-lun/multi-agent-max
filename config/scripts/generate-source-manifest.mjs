import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const targetRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sourceRoot = await resolveSourceRoot(
  process.argv.slice(2).find((argument) => argument !== '--')
)
const selectionPath = resolve(targetRoot, 'migration/source-selection.json')
const selection = JSON.parse(await readFile(selectionPath, 'utf8'))

const entries = await Promise.all(
  selection.entries.map(async (entry) => {
    const sourcePath = await resolveContainedPath(sourceRoot, entry.source)
    const targetPath = await resolveContainedPath(targetRoot, entry.target)
    const sourceBytes = await readFile(sourcePath)
    const targetBytes = await readFile(targetPath)
    return {
      ...entry,
      sourceBytes: (await stat(sourcePath)).size,
      sourceSha256: sha256(sourceBytes),
      targetBytes: (await stat(targetPath)).size,
      targetSha256: sha256(targetBytes),
      changedDuringMigration: !sourceBytes.equals(targetBytes),
      sourceGitStatus: gitOutput(sourceRoot, ['status', '--short', '--', entry.source]).trim()
    }
  })
)

const manifest = {
  schemaVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  sourceRoot,
  sourceHead: gitOutput(sourceRoot, ['rev-parse', 'HEAD']).trim(),
  targetRoot,
  entries
}

await writeFile(
  resolve(targetRoot, 'migration/source-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8'
)

async function resolveSourceRoot(input) {
  if (!input) {
    throw new Error('usage: pnpm manifest:source -- /absolute/path/to/source-repository')
  }
  const resolved = resolve(input)
  if (!isAbsolute(resolved)) {
    throw new Error('source repository path must be absolute')
  }
  return realpath(resolved)
}

async function resolveContainedPath(root, input) {
  const path = resolve(root, input)
  const relativePath = relative(root, path)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`path escapes repository root: ${input}`)
  }
  return realpath(path)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function gitOutput(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}
