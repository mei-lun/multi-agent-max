import type { AttemptResult } from '../../../shared/mam/domain/attempt-result'
import type { ExecutorUsage } from '../../../shared/mam/executor-events'
import {
  AgentAttemptResultPayloadSchema,
  buildAttemptResult,
  type AttemptResultAuthority
} from '../artifacts/attempt-result-builder'

export function tryParsePiStructuredResult(
  resultText: string | null,
  usage: ExecutorUsage,
  authority: AttemptResultAuthority
): AttemptResult | undefined {
  if (!resultText) return undefined
  try {
    const parsed = AgentAttemptResultPayloadSchema.parse(JSON.parse(resultText))
    return buildAttemptResult(
      {
        ...parsed,
        usage: {
          status: usage.status,
          ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
          ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
          ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd })
        }
      },
      authority
    )
  } catch {
    return undefined
  }
}
