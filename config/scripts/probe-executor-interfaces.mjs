import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const targetRoot = resolve(import.meta.dirname, '../..')
const reportPath = resolve(targetRoot, 'docs/acceptance/executor-interface-probe.json')
const probes = [probeCodex(), probeGrok(), probePi()]
const report = {
  schemaVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  platform: process.platform,
  architecture: process.arch,
  probes
}

mkdirSync(dirname(reportPath), { recursive: true })
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

if (process.argv.includes('--require-all') && probes.some((probe) => probe.status !== 'ready')) {
  process.exitCode = 2
}

function probeCodex() {
  const executable = process.env.MAM_CODEX_PATH ?? 'codex'
  const base = probeCommand(
    'codex-cli',
    executable,
    ['exec', '--help'],
    ['--json', '--output-schema', '--ignore-user-config', '--ephemeral', '--model']
  )
  if (base.status !== 'ready') return base
  const schemaDirectory = mkdtempSync(join(tmpdir(), 'mam-codex-schema-'))
  try {
    const generated = run(executable, [
      'app-server',
      'generate-json-schema',
      '--experimental',
      '--out',
      schemaDirectory
    ])
    return {
      ...base,
      status: generated.exitCode === 0 ? 'ready' : 'structured_interface_unavailable',
      appServerSchemaGenerated: generated.exitCode === 0,
      ...(generated.stderr ? { schemaError: firstLine(generated.stderr) } : {})
    }
  } finally {
    rmSync(schemaDirectory, { recursive: true, force: true })
  }
}

function probeGrok() {
  return probeCommand(
    'grok-cli',
    process.env.MAM_GROK_PATH ?? 'grok',
    ['agent', '--help'],
    ['stdio', '--model', '--no-leader']
  )
}

function probePi() {
  return probeCommand('pi-rpc', process.env.MAM_PI_PATH ?? 'pi', ['--help'], ['--mode', /\brpc\b/i])
}

function probeCommand(kind, executable, helpArgs, requirements) {
  const version = run(executable, ['--version'])
  if (version.exitCode !== 0) {
    return {
      kind,
      executable,
      status: 'executable_unavailable',
      error: firstLine(version.stderr || version.stdout || 'command unavailable')
    }
  }
  const help = run(executable, helpArgs)
  const source = `${help.stdout}\n${help.stderr}`
  const missing = requirements
    .filter((requirement) =>
      typeof requirement === 'string' ? !source.includes(requirement) : !requirement.test(source)
    )
    .map(String)
  return {
    kind,
    executable,
    version: firstLine(version.stdout || version.stderr),
    status:
      help.exitCode === 0 && missing.length === 0 ? 'ready' : 'structured_interface_unavailable',
    missing
  }
}

function run(executable, args) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return {
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr || result.error?.message || ''
  }
}

function firstLine(value) {
  return value.split(/\r?\n/, 1)[0].trim()
}
