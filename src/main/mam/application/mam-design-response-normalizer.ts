import {
  MamDesignModelResponseSchema,
  type MamDesignModelResponse
} from '../../../shared/mam/design-proposal'

export function parseMamDesignModelResponse(responseText: string): MamDesignModelResponse {
  const value = JSON.parse(extractJsonObject(responseText))
  return MamDesignModelResponseSchema.parse(normalizeResponseEnvelope(value))
}

function normalizeResponseEnvelope(value: unknown): unknown {
  if (!isRecord(value)) return value
  if ('proposal' in value) {
    return 'brainstorm' in value ? value : { ...value, brainstorm: legacyBrainstorm() }
  }
  if (!('roles' in value) || !('workflow' in value)) return value
  const message =
    typeof value.message === 'string' ? value.message : 'A complete proposal is ready to review.'
  const { roles, workflow } = value
  return {
    message,
    brainstorm: legacyBrainstorm(),
    review: defaultReview(),
    proposal: { roles, workflow }
  }
}

function defaultReview(): Record<string, unknown> {
  return { readiness: 'ready', questions: [], findings: [], assumptions: [] }
}

function legacyBrainstorm(): Record<string, unknown> {
  return {
    question: {
      id: 'clarify-success',
      prompt: 'What outcome would make this Workflow successful for you?',
      whyItMatters: 'The answer determines the acceptance criteria for the final Workflow.',
      options: []
    },
    approaches: [],
    sections: []
  }
}

function extractJsonObject(value: string): string {
  const trimmed = stripFence(value).trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const start = trimmed.indexOf('{')
  if (start < 0) return trimmed
  let depth = 0
  let escaped = false
  let inString = false
  for (let index = start; index < trimmed.length; index += 1) {
    const character = trimmed[index]
    if (!character) continue
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return trimmed.slice(start, index + 1)
    }
  }
  return trimmed
}

function stripFence(value: string): string {
  const match = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(value)
  return match?.[1] ?? value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
