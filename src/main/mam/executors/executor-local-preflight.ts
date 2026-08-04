import { spawnSync } from 'node:child_process'
import { extname, isAbsolute } from 'node:path'
import {
  ExecutorProfileSchema,
  LocalExecutorBindingSchema,
  type ExecutorCapabilities,
  type ExecutorProfile,
  type LocalExecutorBinding
} from '../../../shared/mam/domain/execution-profile'

export type ExecutorProbeResult = Readonly<{
  exitCode: number | null
  stdout: string
  stderr: string
}>

export type ExecutorProbe = (executablePath: string, args: readonly string[]) => ExecutorProbeResult

export type ExecutorPreflightIssue = Readonly<{
  code:
    | 'executor_binding_mismatch'
    | 'config_root_not_absolute'
    | 'executable_unavailable'
    | 'version_unavailable'
    | 'structured_interface_unavailable'
    | 'isolated_config_unavailable'
  message: string
}>

export type ExecutorPreflightResult =
  | Readonly<{
      ok: true
      version: string
      capabilities: ExecutorCapabilities
      evidence: readonly string[]
    }>
  | Readonly<{
      ok: false
      issues: readonly ExecutorPreflightIssue[]
      evidence: readonly string[]
    }>

export class ExecutorLocalPreflight {
  constructor(private readonly probe: ExecutorProbe = systemProbe) {}

  check(
    profileInput: ExecutorProfile,
    bindingInput: LocalExecutorBinding
  ): ExecutorPreflightResult {
    const profile = ExecutorProfileSchema.parse(profileInput)
    const binding = LocalExecutorBindingSchema.parse(bindingInput)
    const issues: ExecutorPreflightIssue[] = []
    const evidence: string[] = []
    if (binding.executorProfileId !== profile.id) {
      addIssue(
        issues,
        'executor_binding_mismatch',
        'Local binding targets another Executor Profile'
      )
    }
    if (!isAbsolute(binding.configRoot)) {
      addIssue(issues, 'config_root_not_absolute', 'Executor config root must be absolute')
    }
    const versionResult = this.probe(binding.executablePath, ['--version'])
    if (versionResult.exitCode !== 0) {
      addIssue(issues, 'executable_unavailable', executableFailure(versionResult))
      return { ok: false, issues, evidence }
    }
    const version = `${versionResult.stdout}\n${versionResult.stderr}`.trim()
    if (!version) addIssue(issues, 'version_unavailable', 'Executor returned no version')
    else evidence.push(`version:${firstLine(version)}`)

    const result = capabilityProbe(profile, binding, this.probe)
    issues.push(...result.issues)
    evidence.push(...result.evidence)
    if (issues.length > 0) return { ok: false, issues, evidence }
    return { ok: true, version: firstLine(version), capabilities: result.capabilities, evidence }
  }
}

function capabilityProbe(
  profile: ExecutorProfile,
  binding: LocalExecutorBinding,
  probe: ExecutorProbe
): Readonly<{
  capabilities: ExecutorCapabilities
  issues: readonly ExecutorPreflightIssue[]
  evidence: readonly string[]
}> {
  if (profile.kind === 'codex-cli') return probeCodex(profile, binding, probe)
  if (profile.kind === 'grok-cli') return probeGrok(profile, binding, probe)
  return probePi(binding, probe)
}

function probeCodex(profile: ExecutorProfile, binding: LocalExecutorBinding, probe: ExecutorProbe) {
  const mode = profile.adapterOptions.mode === 'app-server' ? 'app-server' : 'headless'
  const args = mode === 'app-server' ? ['app-server', '--help'] : ['exec', '--help']
  const result = probe(binding.executablePath, args)
  const help = `${result.stdout}\n${result.stderr}`
  const required =
    mode === 'app-server'
      ? ['--listen', 'generate-json-schema']
      : ['--json', '--output-schema', '--ignore-user-config', '--ephemeral', '--model']
  const missing = required.filter((flag) => !help.includes(flag))
  const issues: ExecutorPreflightIssue[] = []
  if (result.exitCode !== 0 || missing.length > 0) {
    addIssue(
      issues,
      'structured_interface_unavailable',
      `Codex ${mode} interface is missing: ${missing.join(', ') || 'help command failed'}`
    )
  }
  if (!help.includes('-c, --config')) {
    addIssue(
      issues,
      'isolated_config_unavailable',
      'Codex does not expose per-invocation config overrides'
    )
  }
  return {
    capabilities: codexCapabilities(mode),
    issues,
    evidence: [`interface:${mode}`, ...required.map((flag) => `flag:${flag}`)]
  }
}

function probeGrok(profile: ExecutorProfile, binding: LocalExecutorBinding, probe: ExecutorProbe) {
  const issues: ExecutorPreflightIssue[] = []
  if (profile.adapterOptions.mode !== 'acp') {
    addIssue(
      issues,
      'structured_interface_unavailable',
      'Grok Executor Profile must select the verified ACP stdio interface'
    )
  }
  const result = probe(binding.executablePath, ['agent', '--help'])
  const help = `${result.stdout}\n${result.stderr}`
  const required = ['stdio', '--model', '--no-leader']
  const missing = required.filter((marker) => !help.includes(marker))
  if (result.exitCode !== 0 || missing.length > 0) {
    addIssue(
      issues,
      'structured_interface_unavailable',
      `Grok ACP stdio interface is missing: ${missing.join(', ') || 'help command failed'}`
    )
  }
  return {
    capabilities: {
      supportedProtocols: ['openai-completions', 'executor-native'],
      supportsCustomEndpoint: true,
      supportsModelOverride: true,
      supportsPerInstanceConfig: true,
      supportsPerInstanceCredentials: true,
      supportsSkills: true,
      supportedMcpTransports: ['stdio'],
      supportsKnowledgeGateway: true,
      supportsStructuredOutput: true,
      supportsInvocationReconnect: false
    } satisfies ExecutorCapabilities,
    issues,
    evidence: missing.length === 0 ? required.map((marker) => `grok-agent:${marker}`) : []
  }
}

function probePi(binding: LocalExecutorBinding, probe: ExecutorProbe) {
  return probeGenericStructured('Pi', binding, probe, {
    supportedProtocols: [
      'openai-responses',
      'openai-completions',
      'anthropic-messages',
      'google-generative-ai'
    ],
    supportsCustomEndpoint: true,
    supportsModelOverride: true,
    supportsPerInstanceConfig: true,
    supportsPerInstanceCredentials: true,
    supportsSkills: true,
    supportedMcpTransports: [],
    supportsKnowledgeGateway: false,
    supportsStructuredOutput: true,
    supportsInvocationReconnect: false
  })
}

function probeGenericStructured(
  label: string,
  binding: LocalExecutorBinding,
  probe: ExecutorProbe,
  capabilities: ExecutorCapabilities
) {
  const result = probe(binding.executablePath, ['--help'])
  const help = `${result.stdout}\n${result.stderr}`.toLowerCase()
  const structured = /jsonl|json-rpc|\brpc\b|--json/.test(help)
  const issues: ExecutorPreflightIssue[] = []
  if (result.exitCode !== 0 || !structured) {
    addIssue(
      issues,
      'structured_interface_unavailable',
      `${label} CLI does not expose a supported structured interface`
    )
  }
  return {
    capabilities,
    issues,
    evidence: structured ? ['interface:structured'] : []
  }
}

function codexCapabilities(mode: 'headless' | 'app-server'): ExecutorCapabilities {
  return {
    supportedProtocols: ['openai-responses'],
    supportsCustomEndpoint: true,
    supportsModelOverride: true,
    supportsPerInstanceConfig: true,
    supportsPerInstanceCredentials: true,
    supportsSkills: true,
    supportedMcpTransports: ['stdio', 'http'],
    supportsKnowledgeGateway: true,
    supportsStructuredOutput: true,
    supportsInvocationReconnect: mode === 'app-server'
  }
}

function systemProbe(executablePath: string, args: readonly string[]): ExecutorProbeResult {
  const javaScriptEntry = ['.js', '.mjs', '.cjs'].includes(extname(executablePath))
  const result = spawnSync(
    javaScriptEntry ? process.execPath : executablePath,
    [...(javaScriptEntry ? [executablePath] : []), ...args],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(javaScriptEntry && process.versions.electron
        ? { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
        : {})
    }
  )
  return {
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr || result.error?.message || ''
  }
}

function executableFailure(result: ExecutorProbeResult): string {
  return firstLine(result.stderr || result.stdout || 'Executor executable is unavailable')
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0]!.trim()
}

function addIssue(
  issues: ExecutorPreflightIssue[],
  code: ExecutorPreflightIssue['code'],
  message: string
): void {
  issues.push({ code, message })
}
