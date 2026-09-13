import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { redactPiRpcValue } from './pi-rpc-event-normalizer'

type PiFailure = Readonly<{ code: string; message: string }>

/** Settled includes exhausted retries and aborted requests, not just successful responses. */
export class PiRpcOutcome {
  private failure: PiFailure | undefined

  constructor(private readonly secrets: readonly string[]) {}

  observe(event: AgentSessionEvent): void {
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const message = event.message
      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        this.failure = this.failed(
          message.errorMessage || `Pi assistant request ${message.stopReason}`,
          message.stopReason === 'aborted' ? 'executor_aborted' : undefined
        )
      } else {
        this.failure = undefined
      }
    }
    if (event.type === 'auto_retry_end') {
      // Pi also calls an aborted retry successful; only a successful assistant message clears failure.
      if (!event.success && this.failure?.code !== 'executor_aborted') {
        this.failure = this.failed(
          event.finalError || this.failure?.message || 'Pi model retries exhausted'
        )
      }
    }
  }

  getFailure(): PiFailure | undefined {
    return this.failure
  }

  private failed(message: string, code?: string): PiFailure {
    return {
      code:
        code ??
        (/time(?:d\s*out|out)/i.test(message) ? 'executor_timeout' : 'executor_process_failed'),
      message: String(redactPiRpcValue(message, this.secrets))
    }
  }
}
