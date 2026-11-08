import type { ModelProfile, ProviderProfile } from '../../../shared/mam/domain/execution-profile'
import type { CreativeTextParams } from '../../../shared/mam/creative-text'
import type { OperationHandler } from '../creative-runtime/jobs'
import { textRequest } from './request'
import { readUsage } from './usage'

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
export async function executeText(o: {
  model: ModelProfile
  provider: ProviderProfile
  secret: string | undefined
  params: CreativeTextParams
  fetcher: typeof fetch
  context: Parameters<OperationHandler['run']>[1]
  images?: { mime: string; data: string }[]
}) {
  const signal = AbortSignal.any([o.context.signal, AbortSignal.timeout(180000)])
  try {
    signal.throwIfAborted()
    const request = textRequest(o.model, o.provider, o.params, o.secret, o.images)
    const response = await o.fetcher(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal,
      redirect: 'error'
    })
    if (!response.ok || !response.body) throw new Error('Provider rejected text request')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = '',
      text = '',
      total = 0,
      completed = false,
      anthropicStopped = false
    let usage: { inputTokens?: number; outputTokens?: number } = {}
    const event = async (frame: string) => {
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (!data) return
      if (data === '[DONE]') {
        return
      }
      const value = object(JSON.parse(data))
      const observed = readUsage(value)
      if (observed) usage = { ...usage, ...observed }
      if (
        value.error ||
        ['error', 'response.failed', 'response.incomplete'].includes(String(value.type))
      )
        throw new Error('Provider stream failed')
      let delta = ''
      if (o.provider.protocol === 'openai-responses') {
        if (value.type === 'response.output_text.delta' && typeof value.delta === 'string')
          delta = value.delta
        if (value.type === 'response.completed') {
          const status = object(value.response).status
          if (status && status !== 'completed') throw new Error('Incomplete text response')
          completed = true
        }
        const item = object(value.item)
        if (String(value.type).includes('function_call') || item.type === 'function_call')
          throw new Error('Tools forbidden')
      } else if (o.provider.protocol === 'openai-completions') {
        for (const raw of array(value.choices)) {
          const choice = object(raw),
            chunk = object(choice.delta)
          if (chunk.tool_calls || chunk.function_call || choice.finish_reason === 'tool_calls')
            throw new Error('Tools forbidden')
          if (typeof chunk.content === 'string') delta += chunk.content
          if (choice.finish_reason && choice.finish_reason !== 'stop')
            throw new Error('Incomplete text response')
          if (choice.finish_reason === 'stop') completed = true
        }
      } else if (o.provider.protocol === 'anthropic-messages') {
        if (object(value.content_block).type === 'tool_use') throw new Error('Tools forbidden')
        const chunk = object(value.delta)
        if (chunk.type === 'text_delta' && typeof chunk.text === 'string') delta = chunk.text
        if (chunk.stop_reason) {
          if (!['end_turn', 'stop_sequence'].includes(String(chunk.stop_reason)))
            throw new Error('Incomplete text response')
          anthropicStopped = true
        }
        if (value.type === 'message_stop' && anthropicStopped) completed = true
      } else {
        for (const raw of array(value.candidates)) {
          const candidate = object(raw)
          if (candidate.finishReason && candidate.finishReason !== 'STOP')
            throw new Error('Incomplete text response')
          for (const rawPart of array(object(candidate.content).parts)) {
            const part = object(rawPart)
            if (part.functionCall) throw new Error('Tools forbidden')
            if (typeof part.text === 'string' && !part.thought) delta += part.text
          }
          if (candidate.finishReason === 'STOP') completed = true
        }
      }
      if (delta) {
        text += delta
        await o.context.emit('log', { type: 'text_delta', text: delta })
      }
    }
    try {
      while (true) {
        signal.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > 8 * 1024 * 1024) throw new Error('Text response too large')
        pending += decoder.decode(value, { stream: true })
        pending = pending.replace(/\r\n/g, '\n')
        let end: number
        while ((end = pending.indexOf('\n\n')) >= 0) {
          await event(pending.slice(0, end))
          pending = pending.slice(end + 2)
        }
      }
      pending += decoder.decode()
      if (pending.trim()) await event(pending)
      if (!completed || !text.trim()) throw new Error('Incomplete text response')
      const status =
        usage.inputTokens !== undefined && usage.outputTokens !== undefined
          ? 'known'
          : Object.keys(usage).length
            ? 'partial'
            : 'unknown'
      await o.context.emit('usage', { ...usage, status, costStatus: 'unknown' })
      return { text }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  } catch {
    throw new Error(
      signal.aborted ? 'Text generation cancelled or timed out' : 'Text generation failed'
    )
  }
}
