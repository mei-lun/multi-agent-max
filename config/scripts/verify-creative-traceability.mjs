import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const checks = [
  ['MAM-CREATIVE-001', 'local-component-lifecycle', '.mam-local/creative-desktop-qa/latest.json'],
  ['MAM-CREATIVE-003', 'image-speech-host', '.mam-local/media-desktop-qa/latest.json'],
  ['MAM-CREATIVE-003', 'video-playback-recovery', '.mam-local/video-desktop-qa/latest.json'],
  ['MAM-CREATIVE-005', 'original-writing-persistence', '.mam-local/writing-desktop-qa/latest.json'],
  ['MAM-CREATIVE-005', 'original-spine-vision', '.mam-local/spine-desktop-qa/latest.json'],
  ['MAM-CREATIVE-001', 'native-workbench-status', '.mam-local/native-workbenches-qa/latest.json']
]
const evidence = []
for (const [requirement, criterion, path] of checks) {
  try {
    const result = JSON.parse(await readFile(join(root, path), 'utf8'))
    evidence.push({
      requirement,
      criterion,
      path,
      status: result.passed === true ? 'passed' : 'failed',
      scope: result.scope ?? 'local fixture'
    })
  } catch {
    evidence.push({ requirement, criterion, path, status: 'missing' })
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
