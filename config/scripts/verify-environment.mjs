import { accessSync, constants, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectDirectory = resolve(scriptDirectory, '..', '..')
const require = createRequire(import.meta.url)

export function corepackCommand(platform = process.platform) {
  return platform === 'win32' ? 'corepack.cmd' : 'corepack'
}

export function parseVersion(value) {
  const match = String(value)
    .trim()
    .match(/^(\d+)\.(\d+)(?:\.(\d+))?$/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)]
}

export function isVersionAtLeast(actual, minimum) {
  const current = parseVersion(actual)
  const expected = parseVersion(minimum)
  if (!current || !expected) return false
  for (let index = 0; index < current.length; index += 1) {
    if (current[index] > expected[index]) return true
    if (current[index] < expected[index]) return false
  }
  return true
}

export function readNodeMinimum(engine = '') {
  const match = String(engine).match(/>=\s*(\d+\.\d+(?:\.\d+)?)/)
  if (!match) throw new Error(`Unsupported Node engine declaration: ${engine}`)
  return match[1]
}

export function readPackageManager(declaration = '') {
  const match = String(declaration).match(/^pnpm@(\d+\.\d+\.\d+)$/)
  if (!match) throw new Error(`Expected packageManager to be pnpm@x.y.z, received: ${declaration}`)
  return match[1]
}

export function electronExecutablePath(electronDirectory, platform = process.platform) {
  const relativePath = readFileSync(join(electronDirectory, 'path.txt'), 'utf8').trim()
  const expectedName =
    platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron'
  if (relativePath.replaceAll('\\', '/') !== expectedName) {
    throw new Error(`Electron path.txt does not point to ${expectedName}`)
  }
  const executable = resolve(electronDirectory, 'dist', relativePath)
  accessSync(executable, constants.F_OK | constants.X_OK)
  return executable
}

export function verifyElectron(projectRoot = projectDirectory) {
  const electronDirectory = dirname(
    require.resolve('electron/package.json', { paths: [projectRoot] })
  )
  const metadata = JSON.parse(readFileSync(join(electronDirectory, 'package.json'), 'utf8'))
  const executable = electronExecutablePath(electronDirectory)
  return { version: metadata.version, executable }
}

export class NativeArtifactError extends Error {
  constructor(component, cause) {
    super(
      `${component} native artifact is unavailable: ${cause instanceof Error ? cause.message : String(cause)}`
    )
    this.name = 'NativeArtifactError'
  }
}

function readProjectMetadata(projectRoot) {
  return JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
}

function checkNode(metadata) {
  const minimum = readNodeMinimum(metadata.engines?.node)
  if (!isVersionAtLeast(process.versions.node, minimum)) {
    throw new Error(`Node.js ${process.versions.node} is too old; required ${minimum} or newer`)
  }
  return `Node.js ${process.versions.node}`
}

function checkPnpm(metadata) {
  const expected = readPackageManager(metadata.packageManager)
  const actual = execFileSync(corepackCommand(), ['pnpm', '--version'], { encoding: 'utf8' }).trim()
  if (actual !== expected)
    throw new Error(`pnpm ${actual} is active; required ${expected} via Corepack`)
  return `pnpm ${actual} via Corepack`
}

function checkElectron(projectRoot, metadata) {
  const electronDirectory = dirname(
    require.resolve('electron/package.json', { paths: [projectRoot] })
  )
  const installed = JSON.parse(readFileSync(join(electronDirectory, 'package.json'), 'utf8'))
  const expected = metadata.devDependencies?.electron
  if (installed.version !== expected)
    throw new Error(`Electron ${installed.version} is installed; package.json requires ${expected}`)
  try {
    const executable = electronExecutablePath(electronDirectory)
    return `Electron ${installed.version} (${executable})`
  } catch (error) {
    throw new NativeArtifactError('Electron', error)
  }
}

async function checkEsbuild(projectRoot) {
  try {
    const esbuild = await import(require.resolve('esbuild', { paths: [projectRoot] }))
    const output = esbuild.transformSync('const ready = true', { loader: 'js' })
    if (!output.code.includes('ready')) throw new Error('native transform returned invalid output')
    return `esbuild ${esbuild.version}`
  } catch (error) {
    throw new NativeArtifactError('esbuild', error)
  }
}

async function checkSwc(projectRoot) {
  try {
    const swc = await import(require.resolve('@swc/core', { paths: [projectRoot] }))
    if (typeof swc.transformSync !== 'function') throw new Error('transformSync is unavailable')
    return '@swc/core native transform available'
  } catch (error) {
    throw new NativeArtifactError('@swc/core', error)
  }
}

export async function verifyEnvironment(projectRoot = projectDirectory) {
  if (!['darwin', 'win32'].includes(process.platform))
    throw new Error(`Unsupported development platform: ${process.platform}`)
  const metadata = readProjectMetadata(projectRoot)
  const results = [checkNode(metadata), checkPnpm(metadata), checkElectron(projectRoot, metadata)]
  results.push(await checkEsbuild(projectRoot))
  results.push(await checkSwc(projectRoot))
  return results
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    for (const result of await verifyEnvironment()) console.log(`ok: ${result}`)
  } catch (error) {
    console.error(
      `Environment check failed: ${error instanceof Error ? error.message : String(error)}`
    )
    process.exitCode = error instanceof NativeArtifactError ? 2 : 1
  }
}
