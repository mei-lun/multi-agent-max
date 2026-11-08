import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
export async function evidenceBinding(root = process.cwd()) {
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString()
  const files = git('ls-files', '-co', '--exclude-standard', '-z').split('\0').filter(Boolean)
  const hash = createHash('sha256')
  for (const file of [...new Set(files)].sort()) {
    if (/^(docs\/|\.superpowers\/|\.mam-local\/)/.test(file)) continue
    hash.update(file).update('\0')
    try {
      hash.update(await readFile(join(root, file)))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      hash.update('<deleted>')
    }
  }
  const packageManifestHashes = {}
  for (const name of await readdir(join(root, '.mam-local/component-packages')).catch(() => [])) {
    try {
      packageManifestHashes[name] = createHash('sha256')
        .update(await readFile(join(root, '.mam-local/component-packages', name, 'manifest.json')))
        .digest('hex')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return {
    hostCommit: git('rev-parse', 'HEAD').trim(),
    sourceFingerprint: hash.digest('hex'),
    platform: `${process.platform}-${process.arch}`,
    runtime: process.version,
    packageManifestHashes
  }
}
export function evidenceMatches(report, binding) {
  return ['hostCommit', 'sourceFingerprint', 'platform', 'runtime', 'packageManifestHashes'].every(
    (key) => JSON.stringify(report[key]) === JSON.stringify(binding[key])
  )
}
