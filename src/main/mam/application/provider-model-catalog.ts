import {
  MamFetchModelCatalogInputSchema,
  MamModelCatalogResultSchema,
  type MamFetchModelCatalogInput,
  type MamModelCatalogItem,
  type MamModelCatalogResult
} from '../../../shared/mam/model-catalog'

const RESPONSE_LIMIT = 2_000_000
const REQUEST_TIMEOUT_MS = 12_000

type ModelCatalogFetcher = (input: string, init: RequestInit) => Promise<Response>

const defaultFetcher: ModelCatalogFetcher = (input, init) => fetch(input, init)

export class MamProviderModelCatalogService {
  constructor(private readonly fetcher: ModelCatalogFetcher = defaultFetcher) {}

  async fetch(input: unknown): Promise<MamModelCatalogResult> {
    const parsed = MamFetchModelCatalogInputSchema.parse(input)
    const endpoint = buildModelCatalogEndpoint(parsed)
    const headers = requestHeaders(parsed)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await this.fetcher(endpoint, {
        headers,
        redirect: 'error',
        signal: controller.signal
      })
      const body = await readResponseBody(response)
      if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`)
      return MamModelCatalogResultSchema.parse({ models: parseModelCatalog(body) })
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        throw new Error('Fetching the model list timed out')
      }
      if (cause instanceof Error && !isNetworkFailure(cause)) {
        throw cause
      }
      throw new Error('Could not fetch models. Check the API address, format, and API key.')
    } finally {
      clearTimeout(timeout)
    }
  }
}

function isNetworkFailure(cause: Error): boolean {
  return cause instanceof TypeError || cause.message === 'fetch failed'
}

export function buildModelCatalogEndpoint(input: MamFetchModelCatalogInput): string {
  const base = new URL(input.baseUrl ?? defaultBaseUrl(input.protocol))
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    !base.hostname ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new Error('API address must be an HTTP(S) URL without credentials or query parameters')
  }
  const version = input.protocol === 'google-generative-ai' ? 'v1beta' : 'v1'
  const path = base.pathname.replace(/\/+$/, '')
  const lastSegment = path.split('/').filter(Boolean).at(-1)
  const requestedPath = lastSegment?.toLowerCase() === version ? 'models' : `${version}/models`
  base.pathname = `${path || ''}/${requestedPath}`
  return base.toString()
}

function defaultBaseUrl(protocol: MamFetchModelCatalogInput['protocol']): string {
  if (protocol === 'anthropic-messages') return 'https://api.anthropic.com/v1'
  if (protocol === 'google-generative-ai') {
    return 'https://generativelanguage.googleapis.com/v1beta'
  }
  return 'https://api.openai.com/v1'
}

function requestHeaders(input: MamFetchModelCatalogInput): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (input.apiKey) {
    if (input.protocol === 'anthropic-messages') {
      headers['x-api-key'] = input.apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else if (input.protocol === 'google-generative-ai') {
      headers['x-goog-api-key'] = input.apiKey
    } else {
      headers.authorization = `Bearer ${input.apiKey}`
    }
  }
  return headers
}

async function readResponseBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (declaredLength > RESPONSE_LIMIT) throw new Error('Provider response is too large')
  const body = await response.text()
  if (body.length > RESPONSE_LIMIT) throw new Error('Provider response is too large')
  return body
}

export function parseModelCatalog(body: string): MamModelCatalogItem[] {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    throw new Error('Provider returned an invalid model list')
  }
  const items = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.data)
      ? value.data
      : isRecord(value) && Array.isArray(value.models)
        ? value.models
        : []
  const models = items.flatMap((item) => {
    if (!isRecord(item)) return []
    const id = stringValue(item.id) ?? stringValue(item.name)
    if (!id) return []
    const normalizedId = id.trim().replace(/^models\//, '')
    if (!normalizedId || normalizedId.length > 400) return []
    const displayName = stringValue(item.displayName)
    return [{ id: normalizedId, ...(displayName ? { displayName } : {}) }]
  })
  const unique = new Map(models.map((model) => [model.id, model]))
  return [...unique.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
