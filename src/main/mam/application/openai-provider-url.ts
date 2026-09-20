const OPENAI_OPERATION_PATHS = ['/chat/completions', '/responses', '/models'] as const

export function normalizeOpenAiProviderBaseUrl(configured: string): string {
  const base = new URL(configured)
  const path = stripOpenAiOperationPath(base.pathname.replace(/\/+$/, ''))
  // OpenAI-compatible clients conventionally append their operation to /v1.
  base.pathname = path || '/v1'
  return base.toString().replace(/\/$/, '')
}

export function openAiProviderEndpoint(configured: string, operation: string): string {
  const base = new URL(normalizeOpenAiProviderBaseUrl(configured))
  base.pathname = `${base.pathname}/${operation.replace(/^\/+/, '')}`
  return base.toString()
}

function stripOpenAiOperationPath(path: string): string {
  for (const operation of OPENAI_OPERATION_PATHS) {
    if (path.endsWith(operation)) return path.slice(0, -operation.length)
  }
  return path
}
