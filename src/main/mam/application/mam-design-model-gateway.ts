import type {
  ModelProfile,
  ProviderProfile,
  ProviderProtocol
} from '../../../shared/mam/domain/execution-profile'
import type { MamDesignMessage } from '../../../shared/mam/design-assistant'
import { buildDesignModelRequestBody } from './mam-design-model-request'
import { openAiProviderEndpoint } from './openai-provider-url'
import {
  MamDesignModelDiagnostics,
  type MamDesignModelDiagnosticReporter
} from './mam-design-model-diagnostics'
import { readModelResponse } from './mam-design-model-response'
export type {
  MamDesignModelDiagnosticEvent,
  MamDesignModelDiagnosticReporter
} from './mam-design-model-diagnostics'
export {
  buildDesignModelRequestBody,
  designResponseJsonSchema,
  MAM_DESIGN_RESPONSE_SCHEMA_NAME
} from './mam-design-model-request'

const REQUEST_TIMEOUT_MS = 90_000

type ModelFetcher = (input: string, init: RequestInit) => Promise<Response>

export type MamDesignModelGatewayInput = Readonly<{
  model: ModelProfile
  provider: ProviderProfile
  credential?: string
  systemPrompt: string
  messages: readonly MamDesignMessage[]
  signal?: AbortSignal
}>

export class MamDesignModelGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'MamDesignModelGatewayError'
  }
}

export class MamDesignModelGateway {
  constructor(
    private readonly fetcher: ModelFetcher = (input, init) => fetch(input, init),
    private readonly reportDiagnostic?: MamDesignModelDiagnosticReporter,
    private readonly requestTimeoutMs = REQUEST_TIMEOUT_MS
  ) {}

  async generate(input: MamDesignModelGatewayInput): Promise<string> {
    if (input.provider.protocol === 'executor-native') {
      fail('provider_protocol_unsupported', 'Design Assistant requires a direct Model Provider')
    }
    const controller = new AbortController()
    let diagnostics: MamDesignModelDiagnostics | undefined
    const abort = (): void => {
      diagnostics?.requestAborted()
      controller.abort(input.signal?.reason)
    }
    if (input.signal?.aborted) abort()
    else input.signal?.addEventListener('abort', abort, { once: true })
    try {
      const endpoint = buildDesignModelEndpoint(input.provider, input.model)
      const requestDiagnostics = new MamDesignModelDiagnostics(
        input,
        endpoint,
        this.requestTimeoutMs,
        this.reportDiagnostic
      )
      diagnostics = requestDiagnostics
      if (controller.signal.aborted) requestDiagnostics.requestAborted()
      const request = async (
        mode: 'schema' | 'json'
      ): Promise<Readonly<{ response: Response; body: string }>> => {
        const body = JSON.stringify(buildDesignModelRequestBody(input, mode, mode === 'schema'))
        requestDiagnostics.requestStarted(mode, body)
        const responseHeadersTimeout = setTimeout(() => {
          requestDiagnostics.requestAborted()
          controller.abort('timeout')
        }, this.requestTimeoutMs)
        let response: Response
        try {
          response = await this.fetcher(endpoint, {
            method: 'POST',
            headers: requestHeaders(input.provider, input.credential),
            body,
            redirect: 'error',
            signal: controller.signal
          })
        } finally {
          clearTimeout(responseHeadersTimeout)
        }
        requestDiagnostics.responseHeaders(response)
        const responseBody = await readModelResponse(response, controller.signal, () =>
          fail('provider_response_too_large', 'Response is too large')
        )
        requestDiagnostics.requestCompleted(responseBody)
        return { response, body: responseBody }
      }
      let { response, body } = await request('schema')
      requireActiveMamDesignRequest(input.signal, controller.signal)
      if (supportsJsonCompatibilityFallback(input.provider.protocol, response.status)) {
        const fallback = await request('json')
        response = fallback.response
        body = fallback.body
        requireActiveMamDesignRequest(input.signal, controller.signal)
      }
      if (!response.ok) {
        fail(
          'provider_request_failed',
          `Model Provider returned HTTP ${response.status}${providerErrorCode(body)}`
        )
      }
      return extractDesignModelText(input.provider.protocol, body)
    } catch (cause) {
      let error: MamDesignModelGatewayError
      if (cause instanceof MamDesignModelGatewayError) error = cause
      else if (controller.signal.aborted) {
        error = new MamDesignModelGatewayError(
          input.signal?.aborted ? 'design_request_cancelled' : 'design_request_timeout',
          input.signal?.aborted ? 'Design request was cancelled' : 'Design request timed out'
        )
      } else {
        error = new MamDesignModelGatewayError(
          'provider_request_failed',
          cause instanceof Error ? cause.message : 'Could not reach the Model Provider'
        )
      }
      diagnostics?.requestFailed(error.code)
      throw error
    } finally {
      input.signal?.removeEventListener('abort', abort)
    }
  }
}

export function buildDesignModelEndpoint(provider: ProviderProfile, model: ModelProfile): string {
  const base = new URL(provider.baseUrl ?? defaultBaseUrl(provider.protocol))
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    !base.hostname ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    fail('provider_url_invalid', 'Provider URL must be HTTP(S) without credentials or a query')
  }
  const path = base.pathname.replace(/\/+$/, '')
  if (provider.protocol === 'openai-responses' || provider.protocol === 'openai-completions') {
    return openAiProviderEndpoint(base.toString(), providerPath(provider.protocol))
  }
  if (provider.protocol === 'google-generative-ai') {
    const modelId = model.remoteModelId.replace(/^models\//, '')
    base.pathname = `${path || '/v1beta'}/models/${encodeURIComponent(modelId)}:generateContent`
    return base.toString()
  }
  const suffix = providerPath(provider.protocol)
  if (!path.endsWith(`/${suffix}`)) base.pathname = `${path || '/v1'}/${suffix}`
  return base.toString()
}

function providerPath(protocol: ProviderProtocol): string {
  if (protocol === 'openai-responses') return 'responses'
  if (protocol === 'openai-completions') return 'chat/completions'
  if (protocol === 'anthropic-messages') return 'messages'
  return fail('provider_protocol_unsupported', 'Provider protocol cannot generate designs')
}

export function extractDesignModelText(protocol: ProviderProtocol, body: string): string {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    fail('provider_response_invalid', 'Model Provider returned invalid JSON')
  }
  const text =
    protocol === 'openai-responses'
      ? openAiResponseText(value)
      : protocol === 'openai-completions'
        ? chatCompletionText(value)
        : protocol === 'anthropic-messages'
          ? anthropicText(value)
          : protocol === 'google-generative-ai'
            ? googleText(value)
            : undefined
  if (!text?.trim()) fail('provider_response_empty', 'Model Provider returned no assistant text')
  return text.trim()
}

function requestHeaders(provider: ProviderProfile, credential?: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    ...provider.headers
  }
  if (provider.protocol === 'anthropic-messages' && !headers['anthropic-version']) {
    headers['anthropic-version'] = '2023-06-01'
  }
  if (!credential) return headers
  if (provider.protocol === 'anthropic-messages') {
    headers['x-api-key'] = credential
  } else if (provider.protocol === 'google-generative-ai') {
    headers['x-goog-api-key'] = credential
  } else {
    headers.authorization = `Bearer ${credential}`
  }
  return headers
}

function defaultBaseUrl(protocol: ProviderProtocol): string {
  if (protocol === 'anthropic-messages') return 'https://api.anthropic.com/v1'
  if (protocol === 'google-generative-ai') {
    return 'https://generativelanguage.googleapis.com/v1beta'
  }
  return 'https://api.openai.com/v1'
}

function openAiResponseText(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.output_text === 'string') return value.output_text
  if (!Array.isArray(value.output)) return undefined
  return value.output
    .flatMap((item) => (isRecord(item) && Array.isArray(item.content) ? item.content : []))
    .flatMap((item) => (isRecord(item) && typeof item.text === 'string' ? [item.text] : []))
    .join('')
}

function chatCompletionText(value: unknown): string | undefined {
  const choices = isRecord(value) && Array.isArray(value.choices) ? value.choices : []
  const message =
    isRecord(choices[0]) && isRecord(choices[0].message) ? choices[0].message : undefined
  if (!message) return undefined
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return undefined
  return message.content
    .flatMap((part) => (isRecord(part) && typeof part.text === 'string' ? [part.text] : []))
    .join('')
}

function anthropicText(value: unknown): string | undefined {
  const content = isRecord(value) && Array.isArray(value.content) ? value.content : []
  return content
    .flatMap((part) =>
      isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []
    )
    .join('')
}

function googleText(value: unknown): string | undefined {
  const candidates = isRecord(value) && Array.isArray(value.candidates) ? value.candidates : []
  const content =
    isRecord(candidates[0]) && isRecord(candidates[0].content) ? candidates[0].content : undefined
  const parts = content && Array.isArray(content.parts) ? content.parts : []
  return parts
    .flatMap((part) => (isRecord(part) && typeof part.text === 'string' ? [part.text] : []))
    .join('')
}

function supportsJsonCompatibilityFallback(protocol: ProviderProtocol, status: number): boolean {
  return protocol !== 'anthropic-messages' && (status === 400 || status === 422)
}

function providerErrorCode(body: string): string {
  try {
    const value = JSON.parse(body)
    const error = isRecord(value) && isRecord(value.error) ? value.error : undefined
    return error && typeof error.code === 'string' ? ` (${error.code})` : ''
  } catch {
    return ''
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(code: string, message: string): never {
  throw new MamDesignModelGatewayError(code, message)
}

export function requireActiveMamDesignRequest(
  inputSignal: AbortSignal | undefined,
  requestSignal: AbortSignal
): void {
  if (!requestSignal.aborted) return
  fail(
    inputSignal?.aborted ? 'design_request_cancelled' : 'design_request_timeout',
    inputSignal?.aborted ? 'Design request was cancelled' : 'Design request timed out'
  )
}
