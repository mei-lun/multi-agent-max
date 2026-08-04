import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizePiRpcEvent, normalizePiRpcUsage } from './pi-rpc-event-normalizer'
import { PiRpcLogWriter } from './pi-rpc-log-writer'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('Pi RPC event normalization', () => {
  it('preserves unknown events while redacting event payloads and RPC logs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mam-pi-rpc-log-'))
    directories.push(root)
    const logPath = join(root, 'rpc.jsonl')
    const logger = new PiRpcLogWriter(
      logPath,
      ['mam-canary-secret-body'],
      () => '2026-07-28T08:00:00Z'
    )
    const raw = {
      type: 'future_pi_event',
      apiKey: 'mam-canary-secret-key',
      nested: { message: 'credential mam-canary-secret-body' }
    }
    await logger.append('event', raw)
    const event = normalizePiRpcEvent({
      event: raw,
      executorInvocationId: 'executor-invocation.1',
      timestamp: '2026-07-28T08:00:00Z'
    })
    await logger.flush()

    expect(event).toMatchObject({
      type: 'tool_event',
      executorKind: 'pi-rpc',
      sourceEventType: 'future_pi_event',
      payload: {
        apiKey: '[REDACTED]',
        nested: { message: 'credential [REDACTED]' }
      }
    })
    const log = await readFile(logPath, 'utf8')
    expect(log).not.toContain('mam-canary-secret')
    expect(log).toContain('[REDACTED]')
  })

  it('normalizes tokens and cost without inventing zero cost', () => {
    expect(normalizePiRpcUsage(stats(0))).toEqual({
      status: 'known',
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 5
    })
    expect(normalizePiRpcUsage(stats(0.25))).toEqual({
      status: 'known',
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 5,
      costUsd: 0.25
    })
  })

  it('keeps only streaming deltas instead of repeated full assistant messages', () => {
    const event = normalizePiRpcEvent({
      event: {
        type: 'message_update',
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 1,
          delta: '完',
          partial: {
            role: 'assistant',
            content: [{ type: 'thinking', thinkingSignature: 'x'.repeat(100_000) }]
          }
        }
      },
      executorInvocationId: 'executor-invocation.1',
      timestamp: '2026-07-28T08:00:00Z'
    })

    expect(event.payload).toEqual({
      assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: '完' }
    })
    expect(JSON.stringify(event)).not.toContain('thinkingSignature')
  })
})

function stats(cost: number) {
  return {
    sessionFile: undefined,
    sessionId: 'session.1',
    userMessages: 1,
    assistantMessages: 1,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 2,
    tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, total: 18 },
    cost
  }
}
