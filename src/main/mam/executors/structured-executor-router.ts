import type { CodexHeadlessAdapter } from './codex-headless-adapter'
import type { GrokCliAdapter } from './grok-cli-adapter'
import type { PiRpcAdapter } from './pi-rpc-adapter'
import type { AttemptResult } from '../../../shared/mam/domain/attempt-result'
import type { ExecutorEvent, ExecutorUsage } from '../../../shared/mam/executor-events'

type CodexInput = Parameters<CodexHeadlessAdapter['execute']>[0]
type GrokInput = Parameters<GrokCliAdapter['execute']>[0]
type PiInput = Parameters<PiRpcAdapter['execute']>[0]

export type StructuredExecutorInput = CodexInput &
  Pick<GrokInput, 'systemPrompt'> &
  Pick<PiInput, never>

export type StructuredExecutorResult = Readonly<{
  invocation: unknown
  events: readonly ExecutorEvent[]
  usage: ExecutorUsage
  result: AttemptResult
  stderr: string
}>

type CodexExecutor = Readonly<{ execute(input: CodexInput): Promise<StructuredExecutorResult> }>
type GrokExecutor = Readonly<{ execute(input: GrokInput): Promise<StructuredExecutorResult> }>
type PiExecutor = Readonly<{ execute(input: PiInput): Promise<StructuredExecutorResult> }>

export class StructuredExecutorRouter {
  constructor(
    private readonly codex: CodexExecutor,
    private readonly grok: GrokExecutor,
    private readonly pi: PiExecutor
  ) {}

  async execute(input: StructuredExecutorInput): Promise<StructuredExecutorResult> {
    const kind = input.snapshot.executorProfile.kind
    if (input.profile.kind !== kind) {
      throw new Error('executor_profile_snapshot_kind_mismatch')
    }
    if (kind === 'codex-cli') return this.codex.execute(input)
    if (kind === 'grok-cli') return this.grok.execute(input)
    return this.pi.execute(input)
  }
}
