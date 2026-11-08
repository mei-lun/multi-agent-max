export function readUsage(
  value: Record<string, unknown>
): { inputTokens?: number; outputTokens?: number } | undefined {
  const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
  const response = obj(value.response),
    message = obj(value.message)
  const raw = obj(value.usage ?? response.usage ?? message.usage ?? value.usageMetadata)
  const input = raw.input_tokens ?? raw.prompt_tokens ?? raw.promptTokenCount
  const output = raw.output_tokens ?? raw.completion_tokens ?? raw.candidatesTokenCount
  const valid = (v: unknown): v is number =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
  if (!valid(input) && !valid(output)) return
  return {
    ...(valid(input) ? { inputTokens: input } : {}),
    ...(valid(output) ? { outputTokens: output } : {})
  }
}
