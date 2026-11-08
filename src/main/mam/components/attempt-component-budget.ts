import type { CreativeJob } from '../../../shared/mam/creative-runtime'
import { AttemptResultSchema } from '../../../shared/mam/domain/attempt-result'
import type { PreparedAttempt } from '../application/mam-attempt-execution-types'

// Refresh only reconciles a prior video request; edits submit new paid inference.
const potentiallyPaidOperations = new Set([
  'image.generate',
  'image.edit',
  'video.generate',
  'video.edit',
  'speech.generate',
  'text.generate',
  'vision.generate',
  'writing.goal.plan',
  'writing.goal.execute'
])
export const isPaidComponentOperation = (operation: string) =>
  potentiallyPaidOperations.has(operation)

export function assertComponentBudget(
  snapshot: PreparedAttempt['snapshot'],
  operation: string,
  imported = false
) {
  if (!imported && snapshot.budget?.maxCostUsd === 0 && potentiallyPaidOperations.has(operation))
    throw new Error('Component generation exceeds zero cost budget')
}
export function componentJobUsage(job: CreativeJob, snapshot: PreparedAttempt['snapshot']) {
  const events = job.events.filter((event) => event.type === 'usage')
  // Each generation emits one terminal usage event, including nested graph/Goal calls.
  const parsed = events.map((event) => {
    const data =
      event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {}
    const { status, inputTokens, outputTokens } = data
    const costUsd = data.costStatus === 'unknown' ? undefined : data.costUsd
    return AttemptResultSchema.shape.usage.safeParse({ status, inputTokens, outputTokens, costUsd })
  })
  const total: { inputTokens?: number; outputTokens?: number; costUsd?: number } = {}
  for (const result of parsed)
    if (result.success) {
      for (const field of ['inputTokens', 'outputTokens', 'costUsd'] as const) {
        const value = result.data[field]
        if (value !== undefined) total[field] = (total[field] ?? 0) + value
      }
    }
  const complete =
    parsed.length > 0 &&
    parsed.every(
      (result) =>
        result.success &&
        result.data.status === 'known' &&
        ['inputTokens', 'outputTokens', 'costUsd'].every(
          (field) => result.data[field as keyof typeof total] !== undefined
        )
    )
  const usage: {
    status: 'known' | 'partial' | 'unknown'
    inputTokens?: number
    outputTokens?: number
    costUsd?: number
  } = {
    status: complete ? 'known' : Object.keys(total).length ? 'partial' : 'unknown',
    ...total
  }
  const budget = snapshot.budget
  if (
    budget &&
    ((usage.costUsd ?? 0) > budget.maxCostUsd ||
      (usage.inputTokens ?? 0) > budget.maxInputTokens ||
      (usage.outputTokens ?? 0) > budget.maxOutputTokens)
  )
    throw new Error('Reported component usage exceeds frozen budget')
  return usage
}
