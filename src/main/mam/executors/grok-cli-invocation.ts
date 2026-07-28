import { createHash } from 'node:crypto'
import { chmod, copyFile, cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  LocalExecutorBindingSchema,
  type LocalExecutorBinding
} from '../../../shared/mam/domain/execution-profile'
import {
  EffectiveRoleConfigSnapshotSchema,
  type EffectiveRoleConfigSnapshot
} from '../../../shared/mam/domain/role'
import type { MaterializedAttemptResources } from '../profiles/attempt-resource-materializer'

export type GrokCliInvocation = Readonly<{
  command: string
  args: readonly string[]
  cwd: string
  env: Readonly<Record<string, string>>
  secrets: readonly string[]
  invocationDirectory: string
  homeDirectory: string
  runtimeDirectory: string
  configPath: string
  manifestPath: string
  requestTimeoutMs: number
}>

export class GrokCliInvocationConfigError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'GrokCliInvocationConfigError'
  }
}

export async function prepareGrokCliInvocation(input: {
  snapshot: EffectiveRoleConfigSnapshot
  resources: MaterializedAttemptResources
  executorBinding: LocalExecutorBinding
  executorInvocationId: string
  workspacePath: string
  credentialValues: Readonly<Record<string, string>>
}): Promise<GrokCliInvocation> {
  const snapshot = EffectiveRoleConfigSnapshotSchema.parse(input.snapshot)
  const binding = LocalExecutorBindingSchema.parse(input.executorBinding)
  validateBindings(snapshot, binding, input.resources)
  const invocationDirectory = join(
    resolve(binding.configRoot),
    'invocations',
    createHash('sha256').update(input.executorInvocationId).digest('hex')
  )
  if (await pathExists(invocationDirectory)) {
    fail('invocation_already_materialized', 'Grok invocation directory already exists')
  }
  const homeDirectory = join(invocationDirectory, 'home')
  const runtimeDirectory = join(invocationDirectory, 'runtime')
  await Promise.all([
    mkdir(homeDirectory, { recursive: true, mode: 0o700 }),
    mkdir(runtimeDirectory, { recursive: true, mode: 0o700 })
  ])
  await Promise.all([
    chmod(invocationDirectory, 0o700),
    chmod(homeDirectory, 0o700),
    chmod(runtimeDirectory, 0o700)
  ])
  await materializeSkills(input.resources, homeDirectory)
  await materializeAuth(binding, homeDirectory, snapshot)
  const credentialEnvironment = resolveCredentialEnvironment(snapshot, input.credentialValues)
  const configPath = join(homeDirectory, 'config.toml')
  const manifestPath = join(invocationDirectory, 'mam-invocation-manifest.json')
  await Promise.all([
    writeFile(configPath, grokConfig(snapshot), { encoding: 'utf8', mode: 0o600 }),
    writePrivateJson(manifestPath, {
      schemaVersion: '1.0.0',
      attemptId: snapshot.attemptId,
      executorInvocationId: input.executorInvocationId,
      effectiveConfigHash: snapshot.contentHash,
      executorKind: 'grok-cli',
      providerProfileId: snapshot.providerProfile.id,
      modelProfileId: snapshot.modelProfile.id,
      skillIds: snapshot.skills.map((skill) => skill.id),
      mcpServerIds: [],
      knowledgeBaseIds: [],
      inheritGlobalSkills: false,
      inheritGlobalMcp: false
    })
  ])
  await chmod(configPath, 0o600)
  return {
    command: binding.executablePath,
    args: [
      '--deny',
      'agent',
      '--deny',
      'subagent',
      'agent',
      '--model',
      snapshot.execution.remoteModelId,
      '--no-leader',
      'stdio'
    ],
    cwd: resolve(input.workspacePath),
    env: minimalEnvironment({
      GROK_HOME: homeDirectory,
      GROK_RUNTIME_DIR: runtimeDirectory,
      GROK_SUBAGENTS: '0',
      GROK_TELEMETRY_ENABLED: 'false',
      ...credentialEnvironment
    }),
    secrets: Object.values(input.credentialValues),
    invocationDirectory,
    homeDirectory,
    runtimeDirectory,
    configPath,
    manifestPath,
    requestTimeoutMs: snapshot.budget.maxDurationSeconds * 1000
  }
}

function validateBindings(
  snapshot: EffectiveRoleConfigSnapshot,
  binding: LocalExecutorBinding,
  resources: MaterializedAttemptResources
): void {
  if (snapshot.executorProfile.kind !== 'grok-cli') {
    fail('executor_kind_mismatch', 'Grok Adapter requires a grok-cli Effective Config')
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
  if (!['openai-completions', 'executor-native'].includes(snapshot.execution.providerProtocol)) {
    fail('provider_protocol_unsupported', 'Grok supports native or OpenAI completions providers')
  }
  if (snapshot.execution.providerHeaders) {
    fail('provider_headers_unsupported', 'Grok provider headers are not safely materialized')
  }
  if (snapshot.mcpBindings.length > 0) {
    fail('mcp_gateway_unavailable', 'Grok MCP bindings require the MAM MCP Gateway')
  }
  if (snapshot.knowledgeBaseBindings.length > 0) {
    fail(
      'knowledge_gateway_unavailable',
      'Grok knowledge bindings require the MAM Knowledge Gateway'
    )
  }
  if (
    snapshot.execution.adapterOptions.mode !== 'acp' ||
    Object.keys(snapshot.execution.adapterOptions).some((key) => key !== 'mode')
  ) {
    fail('adapter_mode_mismatch', 'Grok Adapter requires the verified ACP stdio mode')
  }
  if (Object.keys(snapshot.execution.inference).length > 0) {
    fail('inference_option_unsupported', 'Grok ACP inference overrides are not verified')
  }
}

function grokConfig(snapshot: EffectiveRoleConfigSnapshot): string {
  const lines = [
    '[cli]',
    'auto_update = false',
    '',
    '[models]',
    `default = ${tomlString(snapshot.execution.remoteModelId)}`,
    '',
    '[features]',
    'telemetry = false',
    'remote_fetch = false',
    '',
    '[subagents]',
    'enabled = false',
    '',
    '[permission]',
    'deny = ["agent", "subagent"]'
  ]
  if (snapshot.execution.providerProtocol === 'openai-completions') {
    if (!snapshot.execution.providerBaseUrl) {
      fail('provider_base_url_required', 'Custom Grok Provider requires a base URL')
    }
    lines.push(
      '',
      `[model.${tomlString(snapshot.execution.remoteModelId)}]`,
      `model = ${tomlString(snapshot.execution.remoteModelId)}`,
      `base_url = ${tomlString(snapshot.execution.providerBaseUrl)}`,
      'api_backend = "chat_completions"',
      ...(snapshot.execution.providerSecretRef ? ['env_key = "MAM_GROK_PROVIDER_KEY"'] : []),
      `context_window = ${snapshot.contextPolicy.maxContextTokens}`
    )
  }
  return `${lines.join('\n')}\n`
}

async function materializeSkills(
  resources: MaterializedAttemptResources,
  homeDirectory: string
): Promise<void> {
  const skillsDirectory = join(homeDirectory, 'skills')
  await mkdir(skillsDirectory, { recursive: true, mode: 0o700 })
  for (const [skillId, source] of Object.entries(resources.skillDirectories)) {
    await cp(source, join(skillsDirectory, safeDirectoryName(skillId)), {
      recursive: true,
      errorOnExist: true,
      force: false
    })
  }
}

async function materializeAuth(
  binding: LocalExecutorBinding,
  homeDirectory: string,
  snapshot: EffectiveRoleConfigSnapshot
): Promise<void> {
  if (snapshot.execution.providerSecretRef || !binding.credentialSourcePath) return
  const source = join(resolve(binding.credentialSourcePath), 'auth.json')
  if (!(await pathExists(source))) return
  const target = join(homeDirectory, 'auth.json')
  await copyFile(source, target)
  await chmod(target, 0o600)
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
  return { MAM_GROK_PROVIDER_KEY: values[expected] }
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
  return id.replace(/[^A-Za-z0-9._-]/g, '-')
}

function tomlString(value: string): string {
  return JSON.stringify(value)
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
  throw new GrokCliInvocationConfigError(code, message)
}
