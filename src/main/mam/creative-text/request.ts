import type { ModelProfile, ProviderProfile } from '../../../shared/mam/domain/execution-profile'
import type { CreativeTextParams } from '../../../shared/mam/creative-text'

export function textRequest(
  model: ModelProfile,
  provider: ProviderProfile,
  params: CreativeTextParams,
  secret?: string,
  images: { mime: string; data: string }[] = []
) {
  const protocol = provider.protocol
  const defaults =
    protocol === 'anthropic-messages'
      ? 'https://api.anthropic.com/v1/'
      : protocol === 'google-generative-ai'
        ? 'https://generativelanguage.googleapis.com/v1beta/'
        : 'https://api.openai.com/v1/'
  const base = new URL(provider.baseUrl ?? defaults)
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error('Invalid text endpoint')
  base.pathname = base.pathname.replace(/\/?$/, '/')
  if (base.pathname === '/')
    base.pathname = protocol === 'google-generative-ai' ? '/v1beta/' : '/v1/'
  const headers = new Headers(provider.headers)
  headers.set('Content-Type', 'application/json')
  if (secret) headers.set('Authorization', `Bearer ${secret}`)
  const messages = [
    ...(params.systemPrompt ? [{ role: 'system', content: params.systemPrompt }] : []),
    {
      role: 'user',
      content: images.length
        ? [
            { type: 'text', text: params.prompt },
            ...images.map((image) => ({
              type: 'image_url',
              image_url: { url: `data:${image.mime};base64,${image.data}` }
            }))
          ]
        : params.prompt
    }
  ]
  let endpoint: string, body: unknown
  if (protocol === 'openai-responses') {
    endpoint = 'responses'
    body = {
      model: model.remoteModelId,
      input: images.length
        ? [
            ...(params.systemPrompt ? [{ role: 'system', content: params.systemPrompt }] : []),
            {
              role: 'user',
              content: [
                { type: 'input_text', text: params.prompt },
                ...images.map((image) => ({
                  type: 'input_image',
                  image_url: `data:${image.mime};base64,${image.data}`
                }))
              ]
            }
          ]
        : messages,
      stream: true,
      store: false,
      ...(params.reasoningEffort ? { reasoning: { effort: params.reasoningEffort } } : {})
    }
  } else if (protocol === 'openai-completions') {
    endpoint = 'chat/completions'
    body = {
      model: model.remoteModelId,
      messages,
      stream: true,
      ...(params.reasoningEffort ? { reasoning_effort: params.reasoningEffort } : {})
    }
  } else if (protocol === 'anthropic-messages') {
    endpoint = 'messages'
    headers.delete('Authorization')
    if (secret) headers.set('x-api-key', secret)
    headers.set('anthropic-version', '2023-06-01')
    body = {
      model: model.remoteModelId,
      messages: [
        {
          role: 'user',
          content: images.length
            ? [
                { type: 'text', text: params.prompt },
                ...images.map((image) => ({
                  type: 'image',
                  source: { type: 'base64', media_type: image.mime, data: image.data }
                }))
              ]
            : params.prompt
        }
      ],
      ...(params.systemPrompt ? { system: params.systemPrompt } : {}),
      max_tokens: 8192,
      stream: true
    }
  } else if (protocol === 'google-generative-ai') {
    if (!/^[\w.-]+$/.test(model.remoteModelId)) throw new Error('Invalid text model')
    endpoint = `models/${model.remoteModelId}:streamGenerateContent?alt=sse`
    headers.delete('Authorization')
    if (secret) headers.set('x-goog-api-key', secret)
    body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: params.prompt },
            ...images.map((image) => ({ inlineData: { mimeType: image.mime, data: image.data } }))
          ]
        }
      ],
      ...(params.systemPrompt
        ? { systemInstruction: { parts: [{ text: params.systemPrompt }] } }
        : {})
    }
  } else throw new Error('Unsupported text protocol')
  return { url: new URL(endpoint, base), headers, body: JSON.stringify(body) }
}
