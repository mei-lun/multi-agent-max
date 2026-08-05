import { readFile } from 'node:fs/promises'
import type {
  ExecutorProfile,
  LocalExecutorBinding
} from '../../../shared/mam/domain/execution-profile'
import type { AttemptResult } from '../../../shared/mam/domain/attempt-result'
import type { EffectiveRoleConfigSnapshot } from '../../../shared/mam/domain/role'
import type { ExecutorEvent, ExecutorUsage } from '../../../shared/mam/executor-events'
import {
  AgentAttemptResultPayloadSchema,
  buildAttemptResult,
  type AttemptResultAuthority
} from '../artifacts/attempt-result-builder'
import type { MaterializedAttemptResources } from '../profiles/attempt-resource-materializer'
import {
  prepareCodexHeadlessInvocation,
  type CodexHeadlessInvocation
} from './codex-headless-invocation'
import { ExecutorLocalPreflight } from './executor-local-preflight'
import { parseCodexJsonl } from './codex-jsonl-parser'
import { runCodexProcess, type CodexProcessRunner } from './codex-process-runner'
import { emitObservedExecutorEvent, type ExecutorEventListener } from './executor-event-listener'

export type CodexHeadlessExecutionResult = Readonly<{
  invocation: CodexHeadlessInvocation
  events: readonly ExecutorEvent[]
  usage: ExecutorUsage
  result: AttemptResult
  stderr: string
}>

export class CodexHeadlessAdapterError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'CodexHeadlessAdapterError'
  }
}

export class CodexHeadlessAdapter {
  constructor(
    private readonly processRunner: CodexProcessRunner = runCodexProcess,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly preflight = new ExecutorLocalPreflight()
  ) {}

  async execute(input: {
    profile: ExecutorProfile
    binding: LocalExecutorBinding
    snapshot: EffectiveRoleConfigSnapshot
    resources: MaterializedAttemptResources
    executorInvocationId: string
    workspacePath: string
    prompt: string
    credentialValues: Readonly<Record<string, string>>
    authority: AttemptResultAuthority
    onEvent?: ExecutorEventListener
  }): Promise<CodexHeadlessExecutionResult> {
    const preflight = this.preflight.check(input.profile, input.binding)
    if (!preflight.ok) {
      fail(
        preflight.issues[0]?.code ?? 'preflight_failed',
        preflight.issues.map((issue) => issue.message).join('; ')
      )
    }
    if (input.profile.kind !== 'codex-cli' || input.profile.adapterOptions.mode === 'app-server') {
      fail('adapter_mode_mismatch', 'CodexHeadlessAdapter requires codex-cli headless mode')
    }
    if (
      input.profile.id !== input.snapshot.executorProfile.id ||
      input.profile.version !== input.snapshot.executorProfile.version
    ) {
      fail('executor_profile_mismatch', 'Executor Profile does not match the Effective Config')
    }
    assertAuthorityBinding(input.snapshot, input.authority)
    const invocation = await prepareCodexHeadlessInvocation({
      ...input,
      executorBinding: input.binding
    })
    const process = await this.processRunner(
      invocation,
      input.snapshot.budget.maxDurationSeconds * 1000,
      (line) => emitParsedLine(line, input.executorInvocationId, this.now(), input.onEvent)
    )
    const parsed = parseCodexJsonl({
      source: process.stdout,
      executorInvocationId: input.executorInvocationId,
      timestamp: this.now()
    })
    if (process.timedOut) {
      fail(
        'executor_timeout',
        `Codex execution exceeded the Attempt budget: ${diagnosticSummary(process.stderr, process.stdout)}`
      )
    }
    if (process.exitCode !== 0) {
      fail(
        'executor_process_failed',
        firstLine(process.stderr) || `Codex exited with ${String(process.exitCode)}`
      )
    }
    if (parsed.errors.length > 0) {
      fail('executor_event_error', parsed.errors.join('; '))
    }
    const payload = await readStructuredResult(invocation.resultPath, parsed.usage)
    const authority = {
      ...input.authority,
      executorInvocationId: input.executorInvocationId,
      effectiveConfigHash: input.snapshot.contentHash
    }
    return {
      invocation,
      events: parsed.events,
      usage: parsed.usage,
      result: buildAttemptResult(payload, authority),
      stderr: process.stderr
    }
  }
}

function emitParsedLine(
  line: string,
  executorInvocationId: string,
  timestamp: string,
  listener: ExecutorEventListener | undefined
): void {
  const parsed = parseCodexJsonl({ source: line, executorInvocationId, timestamp })
  for (const event of parsed.events) emitObservedExecutorEvent(listener, event)
}

async function readStructuredResult(path: string, usage: ExecutorUsage) {
  let source: string
  try {
    source = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      fail('structured_result_missing', 'Codex exited without the required structured result file')
    }
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    fail('structured_result_invalid', `Codex result is not JSON: ${String(error)}`)
  }
  try {
    const payload = AgentAttemptResultPayloadSchema.parse(parsed)
    return AgentAttemptResultPayloadSchema.parse({
      ...payload,
      usage: {
        status: usage.status,
        ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
        ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens })
      }
    })
  } catch (error) {
    fail('structured_result_invalid', `Codex result does not match the schema: ${String(error)}`)
  }
}

function assertAuthorityBinding(
  snapshot: EffectiveRoleConfigSnapshot,
  authority: AttemptResultAuthority
): void {
  if (
    authority.workflowRunId !== snapshot.workflowRunId ||
    authority.taskId !== snapshot.taskId ||
    authority.attemptId !== snapshot.attemptId
  ) {
    fail('result_authority_mismatch', 'Attempt Result authority targets another Effective Config')
  }
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0]?.trim() ?? ''
}

function diagnosticSummary(stderr: string, stdout: string): string {
  const source = stderr.trim() || stdout.trim()
  if (!source) return 'no process diagnostics'
  return source.split(/\r?\n/).at(-1)!.slice(0, 1000)
}

function fail(code: string, message: string): never {
  throw new CodexHeadlessAdapterError(code, message)
}
