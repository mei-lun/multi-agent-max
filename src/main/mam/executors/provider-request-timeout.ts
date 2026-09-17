const MINIMUM_REQUEST_TIMEOUT_MS = 60_000
const MAXIMUM_REQUEST_TIMEOUT_MS = 300_000
const SETTLEMENT_MARGIN_MS = 5_000

export function providerRequestTimeoutMs(remainingBudgetMs: number): number {
  if (
    !Number.isFinite(remainingBudgetMs) ||
    remainingBudgetMs <= MINIMUM_REQUEST_TIMEOUT_MS + SETTLEMENT_MARGIN_MS
  ) {
    throw new Error('attempt_budget_insufficient')
  }
  return Math.min(
    MAXIMUM_REQUEST_TIMEOUT_MS,
    remainingBudgetMs - SETTLEMENT_MARGIN_MS,
    Math.max(MINIMUM_REQUEST_TIMEOUT_MS, Math.floor(remainingBudgetMs / 4))
  )
}
