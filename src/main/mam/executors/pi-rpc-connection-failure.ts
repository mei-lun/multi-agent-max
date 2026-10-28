export type PiRpcFailureCode =
  | 'executor_timeout'
  | 'executor_connection_failed'
  | 'executor_process_failed'

export function classifyPiRpcFailure(message: string): PiRpcFailureCode {
  if (/time(?:d\s*out|out)/i.test(message)) return 'executor_timeout'
  if (
    /(?:fetch failed|network error|connection (?:reset|refused|closed)|socket hang up|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|429\b|502\b|503\b|504\b|rate limit|temporarily unavailable)/i.test(
      message
    )
  ) {
    return 'executor_connection_failed'
  }
  return 'executor_process_failed'
}

export function isRetryableConnectionFailure(code: string | undefined): boolean {
  return code === 'executor_timeout' || code === 'executor_connection_failed'
}
