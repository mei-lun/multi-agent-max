const DEFAULT_RESPONSE_LIMIT = 2_000_000

export async function readModelResponse(
  response: Response,
  signal: AbortSignal,
  onResponseTooLarge: () => never,
  responseLimit = DEFAULT_RESPONSE_LIMIT
): Promise<string> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('text/event-stream') || !response.body) {
    return readResponseBody(response, onResponseTooLarge, responseLimit)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let outputText = ''
  const events: unknown[] = []
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('The request was aborted', 'AbortError')
      const next = await reader.read()
      if (next.done) break
      buffer += decoder.decode(next.value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const event = parseEventLine(line)
        if (!event) continue
        events.push(event)
        if (
          isRecord(event) &&
          event.type === 'response.output_text.delta' &&
          typeof event.delta === 'string'
        ) {
          outputText += event.delta
        }
      }
    }
    const terminalEvent = parseEventLine(buffer)
    if (terminalEvent) {
      events.push(terminalEvent)
      if (
        isRecord(terminalEvent) &&
        terminalEvent.type === 'response.output_text.delta' &&
        typeof terminalEvent.delta === 'string'
      ) {
        outputText += terminalEvent.delta
      }
    }
  } finally {
    reader.releaseLock()
  }
  if (outputText) return JSON.stringify({ output_text: outputText })
  const completed = events.find(
    (event): event is Record<string, unknown> =>
      isRecord(event) && event.type === 'response.completed'
  )
  if (completed && isRecord(completed.response)) return JSON.stringify(completed.response)
  return JSON.stringify({ output: [] })
}

function readResponseBody(
  response: Response,
  onResponseTooLarge: () => never,
  responseLimit: number
): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (declaredLength > responseLimit) onResponseTooLarge()
  return response.text().then((body) => {
    if (body.length > responseLimit) onResponseTooLarge()
    return body
  })
}

function parseEventLine(line: string): unknown | undefined {
  if (!line.startsWith('data:')) return undefined
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') return undefined
  try {
    return JSON.parse(payload)
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
