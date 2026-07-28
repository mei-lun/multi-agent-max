import { createHash } from 'node:crypto'
import { chmod, cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { RpcClientOptions } from '@earendil-works/pi-coding-agent'
import {
  LocalExecutorBindingSchema,
  type LocalExecutorBinding
} from '../../../shared/mam/domain/execution-profile'
import {
  EffectiveRoleConfigSnapshotSchema,
  type EffectiveRoleConfigSnapshot
} from '../../../shared/mam/domain/role'
import type { MaterializedAttemptResources } from '../profiles/attempt-resource-materializer'
import { PI_ISOLATED_LAUNCHER_SOURCE } from './pi-isolated-launcher-source'

export type PiRpcInvocation = Readonly<{
  launchOptions: RpcClientOptions
  invocationDirectory: string
  agentDirectory: string
  sessionDirectory: string
  modelsPath: string
  manifestPath: string
  rpcLogPath: string
}>

export class PiRpcInvocationConfigError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'PiRpcInvocationConfigError'
  }
}

export async function preparePiRpcInvocation(input: {
  snapshot: EffectiveRoleConfigSnapshot
  resources: MaterializedAttemptResources
  executorBinding: LocalExecutorBinding
  executorInvocationId: string
  workspacePath: string
  systemPrompt: string
  credentialValues: Readonly<Record<string, string>>
}): Promise<PiRpcInvocation> {
  const snapshot = EffectiveRoleConfigSnapshotSchema.parse(input.snapshot)
  const binding = LocalExecutorBindingSchema.parse(input.executorBinding)
  validateBindings(snapshot, binding, input.resources)
  const invocationDirectory = join(
    resolve(binding.configRoot),
    'invocations',
    createHash('sha256').update(input.executorInvocationId).digest('hex')
  )
  if (await pathExists(invocationDirectory)) {
    fail('invocation_already_materialized', 'Pi invocation directory already exists')
  }
  const agentDirectory = join(invocationDirectory, 'agent')
  const sessionDirectory = join(invocationDirectory, 'sessions')
  await Promise.all([
    mkdir(agentDirectory, { recursive: true, mode: 0o700 }),
    mkdir(sessionDirectory, { recursive: true, mode: 0o700 })
  ])
  await Promise.all([
    chmod(invocationDirectory, 0o700),
    chmod(agentDirectory, 0o700),
    chmod(sessionDirectory, 0o700)
  ])

  const credentialEnvironment = resolveCredentialEnvironment(snapshot, input.credentialValues)
  const skillPaths = await materializeSkills(input.resources, agentDirectory)
  const modelsPath = join(agentDirectory, 'models.json')
  const manifestPath = join(agentDirectory, 'mam-invocation-manifest.json')
  const launcherPath = join(agentDirectory, 'mam-pi-launcher.mjs')
  const rpcLogPath = join(invocationDirectory, 'rpc.jsonl')
  const args = piArguments(snapshot, input.systemPrompt, sessionDirectory, skillPaths)
  const piEnvironment = minimalEnvironment({
    PI_CODING_AGENT_DIR: agentDirectory,
    PI_CODING_AGENT_SESSION_DIR: sessionDirectory,
    PI_OFFLINE: '1',
    PI_SKIP_VERSION_CHECK: '1',
    PI_TELEMETRY: '0',
    ...credentialEnvironment
  })
  await Promise.all([
    writePrivateJson(modelsPath, piModels(snapshot)),
    writePrivateJson(manifestPath, {
      schemaVersion: '1.0.0',
      attemptId: snapshot.attemptId,
      executorInvocationId: input.executorInvocationId,
      effectiveConfigHash: snapshot.contentHash,
      executorKind: 'pi-rpc',
      providerProfileId: snapshot.providerProfile.id,
      modelProfileId: snapshot.modelProfile.id,
      skillIds: snapshot.skills.map((skill) => skill.id),
      mcpServerIds: [],
      knowledgeBaseIds: [],
      extensionIds: [],
      environmentKeys: Object.keys(piEnvironment).sort()
    }),
    writeFile(launcherPath, PI_ISOLATED_LAUNCHER_SOURCE, { encoding: 'utf8', mode: 0o700 })
  ])
  return {
    launchOptions: {
      cliPath: launcherPath,
      cwd: resolve(input.workspacePath),
      args,
      env: {
        ...piEnvironment,
        MAM_PI_EXECUTABLE: binding.executablePath,
        MAM_PI_ENVIRONMENT_KEYS: JSON.stringify(Object.keys(piEnvironment))
      },
      provider: snapshot.providerProfile.id,
      model: snapshot.execution.remoteModelId
    },
    invocationDirectory,
    agentDirectory,
    sessionDirectory,
    modelsPath,
    manifestPath,
    rpcLogPath
  }
}

function validateBindings(
  snapshot: EffectiveRoleConfigSnapshot,
  binding: LocalExecutorBinding,
  resources: MaterializedAttemptResources
): void {
  if (snapshot.executorProfile.kind !== 'pi-rpc') {
    fail('executor_kind_mismatch', 'Pi RPC Adapter requires a pi-rpc Effective Config')
  }
  if (snapshot.executorProfile.id !== binding.executorProfileId) {
    fail('executor_binding_mismatch', 'Local Executor binding targets another profile')
  }
  if (
    resources.attemptId !== snapshot.attemptId ||
    resources.contentHash !== snapshot.contentHash
  ) {
    fail('resource_bundle_mismatch', 'Attempt resource bundle targets another Effective Config')
  }
  if (snapshot.execution.providerProtocol === 'executor-native') {
    fail('provider_protocol_unsupported', 'Pi RPC requires an explicit model provider protocol')
  }
  if (snapshot.execution.providerHeaders) {
    fail('provider_headers_unsupported', 'Pi provider headers are not safely materialized')
  }
  if (snapshot.mcpBindings.length > 0) {
    fail('mcp_gateway_unavailable', 'Pi MCP bindings require the MAM MCP Gateway')
  }
  if (snapshot.knowledgeBaseBindings.length > 0) {
    fail('knowledge_gateway_unavailable', 'Pi knowledge bindings require the MAM Knowledge Gateway')
  }
  const adapterOptions = Object.keys(snapshot.execution.adapterOptions).filter(
    (key) => key !== 'mode'
  )
  if (
    snapshot.execution.adapterOptions.mode !== undefined &&
    snapshot.execution.adapterOptions.mode !== 'rpc'
  ) {
    fail('adapter_mode_mismatch', 'Pi Adapter supports only RPC mode')
  }
  if (adapterOptions.length > 0) {
    fail(
      'adapter_option_unsupported',
      `Unsupported Pi Adapter options: ${adapterOptions.join(', ')}`
    )
  }
  const inferenceOptions = Object.keys(snapshot.execution.inference).filter(
    (key) => key !== 'thinkingLevel'
  )
  if (inferenceOptions.length > 0) {
    fail(
      'inference_option_unsupported',
      `Unsupported Pi inference options: ${inferenceOptions.join(', ')}`
    )
  }
}

function piModels(snapshot: EffectiveRoleConfigSnapshot): Record<string, unknown> {
  const secretEnvironmentKey = snapshot.execution.providerSecretRef
    ? 'MAM_PI_PROVIDER_KEY'
    : undefined
  return {
    providers: {
      [snapshot.providerProfile.id]: {
        api: snapshot.execution.providerProtocol,
        ...(snapshot.execution.providerBaseUrl
          ? { baseUrl: snapshot.execution.providerBaseUrl }
          : {}),
        ...(secretEnvironmentKey ? { apiKey: `$${secretEnvironmentKey}` } : {}),
        models: [
          {
            id: snapshot.execution.remoteModelId,
            name: snapshot.execution.remoteModelId,
            contextWindow: snapshot.contextPolicy.maxContextTokens,
            maxTokens: snapshot.budget.maxOutputTokens
          }
        ]
      }
    }
  }
}

function piArguments(
  snapshot: EffectiveRoleConfigSnapshot,
  systemPrompt: string,
  sessionDirectory: string,
  skillPaths: readonly string[]
): string[] {
  const args = [
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--no-themes',
    '--no-context-files',
    '--no-approve',
    '--session-dir',
    sessionDirectory,
    '--system-prompt',
    systemPrompt
  ]
  for (const skillPath of skillPaths) args.push('--skill', skillPath)
  if (snapshot.tools.length > 0) args.push('--tools', snapshot.tools.join(','))
  else args.push('--no-tools')
  const thinkingLevel = snapshot.execution.inference.thinkingLevel
  if (typeof thinkingLevel === 'string') args.push('--thinking', thinkingLevel)
  return args
}

async function materializeSkills(
  resources: MaterializedAttemptResources,
  agentDirectory: string
): Promise<string[]> {
  const skillsDirectory = join(agentDirectory, 'skills')
  await mkdir(skillsDirectory, { recursive: true, mode: 0o700 })
  const paths: string[] = []
  for (const [skillId, source] of Object.entries(resources.skillDirectories)) {
    const target = join(skillsDirectory, safeDirectoryName(skillId))
    await cp(source, target, { recursive: true, errorOnExist: true, force: false })
    paths.push(target)
  }
  return paths
}

function resolveCredentialEnvironment(
  snapshot: EffectiveRoleConfigSnapshot,
  values: Readonly<Record<string, string>>
): Record<string, string> {
  const expected = snapshot.execution.providerSecretRef
  const actual = Object.keys(values)
  if (!expected) {
    if (actual.length > 0) fail('unexpected_credential', 'No Provider credential is configured')
    return {}
  }
  if (!values[expected]) fail('secret_unavailable', `Credential ${expected} is unavailable`)
  if (actual.some((key) => key !== expected)) {
    fail('unexpected_credential', 'Credential input exceeds the Effective Config allowlist')
  }
  return { MAM_PI_PROVIDER_KEY: values[expected] }
}

function minimalEnvironment(extra: Readonly<Record<string, string>>): Record<string, string> {
  const allowed = [
    'COMSPEC',
    'LANG',
    'LC_ALL',
    'PATH',
    'PATHEXT',
    'SHELL',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'TMPDIR',
    'WINDIR'
  ]
  return {
    ...Object.fromEntries(
      allowed.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]!]]))
    ),
    ...extra
  }
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await chmod(path, 0o600)
}

function safeDirectoryName(id: string): string {
  return basename(id.replace(/[^A-Za-z0-9._-]/g, '-'))
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function fail(code: string, message: string): never {
  throw new PiRpcInvocationConfigError(code, message)
}
