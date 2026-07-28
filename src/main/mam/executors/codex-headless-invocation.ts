import { createHash } from 'node:crypto'
import { chmod, copyFile, cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import {
  LocalExecutorBindingSchema,
  type LocalExecutorBinding
} from '../../../shared/mam/domain/execution-profile'
import {
  EffectiveRoleConfigSnapshotSchema,
  type EffectiveRoleConfigSnapshot
} from '../../../shared/mam/domain/role'
import { agentAttemptResultJsonSchema } from '../artifacts/attempt-result-builder'
import type { MaterializedAttemptResources } from '../profiles/attempt-resource-materializer'

export type CodexHeadlessInvocation = Readonly<{
  executablePath: string
  args: readonly string[]
  cwd: string
  env: Readonly<Record<string, string>>
  input: string
  invocationDirectory: string
  resultPath: string
  schemaPath: string
}>

export class CodexInvocationConfigError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'CodexInvocationConfigError'
  }
}

export async function prepareCodexHeadlessInvocation(input: {
  snapshot: EffectiveRoleConfigSnapshot
  resources: MaterializedAttemptResources
  executorBinding: LocalExecutorBinding
  executorInvocationId: string
  workspacePath: string
  prompt: string
  credentialValues: Readonly<Record<string, string>>
}): Promise<CodexHeadlessInvocation> {
  const snapshot = EffectiveRoleConfigSnapshotSchema.parse(input.snapshot)
  const binding = LocalExecutorBindingSchema.parse(input.executorBinding)
  validateBinding(snapshot, binding)
  if (
    input.resources.attemptId !== snapshot.attemptId ||
    input.resources.contentHash !== snapshot.contentHash
  ) {
    fail('resource_bundle_mismatch', 'Attempt resource bundle targets another Effective Config')
  }
  const invocationDirectory = join(
    resolve(binding.configRoot),
    'invocations',
    createHash('sha256').update(input.executorInvocationId).digest('hex')
  )
  if (await pathExists(invocationDirectory)) {
    fail('invocation_already_materialized', 'Executor invocation directory already exists')
  }
  const codexHome = join(invocationDirectory, 'codex-home')
  const resultPath = join(invocationDirectory, 'agent-result.json')
  const schemaPath = join(invocationDirectory, 'agent-result.schema.json')
  await mkdir(codexHome, { recursive: true, mode: 0o700 })
  await chmod(invocationDirectory, 0o700)
  await materializeSkills(input.resources, codexHome)
  await materializeAuth(binding, codexHome, snapshot)
  const credentialEnvironment = resolveCredentialEnvironment(snapshot, input.credentialValues)
  await Promise.all([
    writePrivateJson(schemaPath, agentAttemptResultJsonSchema()),
    writeFile(join(codexHome, 'config.toml'), codexConfig(snapshot), {
      encoding: 'utf8',
      mode: 0o600
    })
  ])
  return {
    executablePath: binding.executablePath,
    args: invocationArgs(snapshot, schemaPath, resultPath, input.workspacePath),
    cwd: resolve(input.workspacePath),
    env: minimalEnvironment({ CODEX_HOME: codexHome, ...credentialEnvironment }),
    input: input.prompt,
    invocationDirectory,
    resultPath,
    schemaPath
  }
}

function validateBinding(
  snapshot: EffectiveRoleConfigSnapshot,
  binding: LocalExecutorBinding
): void {
  if (snapshot.executorProfile.kind !== 'codex-cli') {
    fail('executor_kind_mismatch', 'Codex Adapter requires a codex-cli Effective Config')
  }
  if (snapshot.executorProfile.id !== binding.executorProfileId) {
    fail('executor_binding_mismatch', 'Local Executor binding targets another profile')
  }
  if (snapshot.execution.providerProtocol !== 'openai-responses') {
    fail('provider_protocol_unsupported', 'Codex headless Adapter requires Responses protocol')
  }
  if (snapshot.execution.providerHeaders) {
    fail('provider_headers_unsupported', 'Codex provider headers are not yet safely materialized')
  }
  const unsupportedInference = Object.keys(snapshot.execution.inference).filter(
    (key) => key !== 'reasoningEffort' && key !== 'serviceTier'
  )
  if (unsupportedInference.length > 0) {
    fail(
      'inference_option_unsupported',
      `Unsupported Codex inference options: ${unsupportedInference.join(', ')}`
    )
  }
}

function invocationArgs(
  snapshot: EffectiveRoleConfigSnapshot,
  schemaPath: string,
  resultPath: string,
  workspacePath: string
): string[] {
  return [
    'exec',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--output-schema',
    schemaPath,
    '--output-last-message',
    resultPath,
    '--model',
    snapshot.execution.remoteModelId,
    '--sandbox',
    snapshot.permissions.writePaths.length > 0 ? 'workspace-write' : 'read-only',
    '--cd',
    resolve(workspacePath),
    '-'
  ]
}

function codexConfig(snapshot: EffectiveRoleConfigSnapshot): string {
  const lines = ['approval_policy = "never"']
  const reasoningEffort = snapshot.execution.inference.reasoningEffort
  const serviceTier = snapshot.execution.inference.serviceTier
  if (typeof reasoningEffort === 'string') {
    lines.push(`model_reasoning_effort = ${tomlString(reasoningEffort)}`)
  }
  if (typeof serviceTier === 'string') lines.push(`service_tier = ${tomlString(serviceTier)}`)
  if (snapshot.execution.providerBaseUrl) {
    lines.push('model_provider = "mam"', '', '[model_providers.mam]')
    lines.push('name = "MAM Attempt Provider"')
    lines.push(`base_url = ${tomlString(snapshot.execution.providerBaseUrl)}`)
    lines.push('wire_api = "responses"')
    if (snapshot.execution.providerSecretRef) lines.push('env_key = "MAM_CODEX_PROVIDER_KEY"')
  }
  return `${lines.join('\n')}\n`
}

function resolveCredentialEnvironment(
  snapshot: EffectiveRoleConfigSnapshot,
  values: Readonly<Record<string, string>>
): Record<string, string> {
  const expected = snapshot.execution.providerSecretRef
  const keys = Object.keys(values)
  if (!expected) {
    if (keys.length > 0) fail('unexpected_credential', 'No Provider credential is configured')
    return {}
  }
  if (!values[expected]) fail('secret_unavailable', `Credential ${expected} is unavailable`)
  if (keys.some((key) => key !== expected)) {
    fail('unexpected_credential', 'Credential input exceeds the Effective Config allowlist')
  }
  return snapshot.execution.providerBaseUrl
    ? { MAM_CODEX_PROVIDER_KEY: values[expected] }
    : { OPENAI_API_KEY: values[expected] }
}

async function materializeSkills(
  resources: MaterializedAttemptResources,
  codexHome: string
): Promise<void> {
  const skillsRoot = join(codexHome, 'skills')
  await mkdir(skillsRoot, { recursive: true, mode: 0o700 })
  for (const [skillId, source] of Object.entries(resources.skillDirectories)) {
    await cp(source, join(skillsRoot, safeDirectoryName(skillId)), {
      recursive: true,
      errorOnExist: true,
      force: false
    })
  }
}

async function materializeAuth(
  binding: LocalExecutorBinding,
  codexHome: string,
  snapshot: EffectiveRoleConfigSnapshot
): Promise<void> {
  if (snapshot.execution.providerSecretRef || !binding.credentialSourcePath) return
  const source = join(resolve(binding.credentialSourcePath), 'auth.json')
  if (!(await pathExists(source))) return
  const target = join(codexHome, 'auth.json')
  await copyFile(source, target)
  await chmod(target, 0o600)
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
  const env = Object.fromEntries(
    allowed.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]!]]))
  )
  return { ...env, ...extra }
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await chmod(path, 0o600)
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

function safeDirectoryName(id: string): string {
  return basename(id.replace(/[^A-Za-z0-9._-]/g, '-'))
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function fail(code: string, message: string): never {
  throw new CodexInvocationConfigError(code, message)
}
