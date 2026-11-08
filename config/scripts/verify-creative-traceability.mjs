import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { evidenceBinding, evidenceMatches } from './creative-evidence-binding.mjs'

const root = process.cwd()
const currentBinding = await evidenceBinding(root)
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 })
const hostCommit = git('rev-parse', 'HEAD').toString().trim()
const fingerprint = createHash('sha256').update(git('diff', 'HEAD', '--binary'))
for (const file of git('ls-files', '--others', '--exclude-standard', '-z')
  .toString()
  .split('\0')
  .filter(Boolean)
  .sort()) {
  fingerprint
    .update(file)
    .update('\0')
    .update(await readFile(join(root, file)))
}
const dirtyFingerprint = fingerprint.digest('hex')
const checks = [
  ['MAM-CREATIVE-001', 'local-component-lifecycle', '.mam-local/creative-desktop-qa/latest.json'],
  ['MAM-CREATIVE-003', 'image-speech-host', '.mam-local/media-desktop-qa/latest.json'],
  ['MAM-CREATIVE-003', 'video-playback-recovery', '.mam-local/video-desktop-qa/latest.json'],
  ['MAM-CREATIVE-005', 'original-writing-persistence', '.mam-local/writing-desktop-qa/latest.json'],
  ['MAM-CREATIVE-005', 'original-spine-vision', '.mam-local/spine-desktop-qa/latest.json'],
  ['MAM-CREATIVE-001', 'native-workbench-status', '.mam-local/native-workbenches-qa/latest.json'],
  ['MAM-CREATIVE-001', 'offscreen-source', '.mam-local/creative-offscreen/latest.json'],
  ['MAM-CREATIVE-001', 'packaged-components', '.mam-local/packaged-creative-qa/latest.json'],
  ['MAM-CREATIVE-005', 'graph-file-tool-conversation', '.mam-local/graph-desktop-qa/latest.json']
]
const evidence = []
for (const [requirement, criterion, path] of checks) {
  try {
    const result = JSON.parse(await readFile(join(root, path), 'utf8'))
    evidence.push({
      requirement,
      criterion,
      path,
      status: !evidenceMatches(result, currentBinding)
        ? 'not_run'
        : result.passed === true
          ? 'passed'
          : 'failed',
      binding: {
        hostCommit: result.hostCommit ?? null,
        sourceFingerprint: result.sourceFingerprint ?? null,
        platform: result.platform ?? null,
        runtime: result.runtime ?? null,
        packageManifestHashes: result.packageManifestHashes ?? null
      },
      scope: result.scope ?? 'local fixture'
    })
  } catch {
    evidence.push({ requirement, criterion, path, status: 'not_run' })
  }
}
const pending = [
  'Paid provider online compatibility and output quality',
  'Real music/model3d GPU inference and ComfyUI layer inference',
  'macOS native acceptance',
  'Publisher-signed online component catalog',
  'Spine editor import/edit/save/reopen roundtrip'
]
const report = {
  schemaVersion: 1,
  ...currentBinding,
  hostCommit,
  dirtyFingerprint,
  platform: `${process.platform}-${process.arch}`,
  runtime: process.version,
  generatedAt: new Date().toISOString(),
  hostVersion: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version,
  status: 'partial',
  localEvidencePassed: evidence.every((item) => item.status === 'passed'),
  evidence,
  pending
}
await mkdir(join(root, 'docs/acceptance'), { recursive: true })
await writeFile(
  join(root, 'docs/acceptance/creative-traceability.json'),
  JSON.stringify(report, null, 2) + '\n'
)
console.log(JSON.stringify(report, null, 2))
if (!report.localEvidencePassed) process.exitCode = 1
