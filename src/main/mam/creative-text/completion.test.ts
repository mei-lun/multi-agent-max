import { expect, test } from 'vitest'
import { executeText } from './transport'
import type { ProviderProtocol } from '../../../shared/mam/domain/execution-profile'

const cases: [ProviderProtocol, unknown[]][] = [
  [
    'openai-completions',
    [
      { choices: [{ delta: { content: 'partial' } }] },
      { choices: [{ finish_reason: 'length' }] },
      '[DONE]'
    ]
  ],
  [
    'openai-completions',
    [
      { choices: [{ delta: { content: 'partial' } }] },
      { choices: [{ finish_reason: 'content_filter' }] },
      '[DONE]'
    ]
  ],
  [
    'anthropic-messages',
    [
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
      { type: 'message_stop' }
    ]
  ],
  [
    'google-generative-ai',
    [
      { candidates: [{ content: { parts: [{ text: 'partial' }] } }] },
      { candidates: [{ finishReason: 'MAX_TOKENS' }] }
    ]
  ],
  [
    'google-generative-ai',
    [
      { candidates: [{ content: { parts: [{ text: 'partial' }] } }] },
      { candidates: [{ finishReason: 'SAFETY' }] }
    ]
  ],
  [
    'openai-responses',
    [
      { type: 'response.output_text.delta', delta: 'partial' },
      {
        type: 'response.incomplete',
        response: { incomplete_details: { reason: 'max_output_tokens' } }
      }
    ]
  ]
]
test.each(cases)(
  '%s incomplete terminal preserves partial events and fails sanitized',
  async (protocol, events) => {
    const deltas: unknown[] = []
    const stream = events
      .map((value) => `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`)
      .join('')
    await expect(
      executeText({
        model: {
          id: 'm',
          version: 1,
          displayName: 'm',
          providerProfileId: 'p',
          remoteModelId: 'm',
          capabilities: {
            modalities: ['text'],
            supportsTools: false,
            supportsStructuredOutput: false
          }
        },
        provider: { id: 'p', version: 1, protocol },
        params: { modelProfileId: 'm', prompt: 'p' },
        secret: undefined,
        fetcher: async () => new Response(stream),
        context: {
          signal: new AbortController().signal,
          emit: async (_type, data) => {
            deltas.push(data)
          }
        }
      })
    ).rejects.toThrow('Text generation failed')
    expect(deltas).toEqual([{ type: 'text_delta', text: 'partial' }])
  }
)
