import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const projectDirectory = process.cwd()
const packageMetadata = JSON.parse(readFileSync(resolve(projectDirectory, 'package.json'), 'utf8'))
const architecture = readArchitecture(process.argv.slice(2))
const applicationDirectory = architecture === 'arm64' ? 'mac-arm64' : 'mac'
const applicationPath = resolve(
  projectDirectory,
  'release',
  applicationDirectory,
  'Multi-Agent Max.app'
)
const outputPath = resolve(
  projectDirectory,
  'release',
  `Multi-Agent-Max-${String(packageMetadata.version)}-mac-${architecture}.dmg`
)
if (!existsSync(applicationPath)) {
  throw new Error(`Packaged application is missing: ${applicationPath}`)
}

const stagingDirectory = mkdtempSync(join(tmpdir(), 'mam-dmg-'))
try {
  run('ditto', [applicationPath, join(stagingDirectory, 'Multi-Agent Max.app')])
  symlinkSync('/Applications', join(stagingDirectory, 'Applications'))
  run('hdiutil', [
    'create',
    '-volname',
    'Multi-Agent Max',
    '-srcfolder',
    stagingDirectory,
    '-ov',
    '-format',
    'UDZO',
    outputPath
  ])
} finally {
  rmSync(stagingDirectory, { recursive: true, force: true })
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${String(result.status)}`)
  }
}

function readArchitecture(args) {
  if (args.length !== 2 || args[0] !== '--arch' || !['x64', 'arm64'].includes(args[1])) {
    throw new Error('Usage: create-mac-dmg.mjs --arch <x64|arm64>')
  }
  return args[1]
}
