import {
  MamDesignModelResponseSchema,
  type MamDesignModelResponse
} from '../../../shared/mam/design-proposal'

export function parseMamDesignModelResponse(responseText: string): MamDesignModelResponse {
  const value = JSON.parse(extractJsonObject(responseText))
  const normalized = normalizeResponseEnvelope(value)
  const parsed = MamDesignModelResponseSchema.safeParse(normalized)
  if (parsed.success) return parsed.data
  return MamDesignModelResponseSchema.parse(stripUnrecognizedKeys(normalized, parsed.error.issues))
}

function normalizeResponseEnvelope(value: unknown): unknown {
  if (!isRecord(value)) return value
  if ('proposal' in value) {
    return normalizeReviewBounds(
      'brainstorm' in value ? value : { ...value, brainstorm: legacyBrainstorm() }
    )
  }
  if (!('roles' in value) || !('workflow' in value)) return value
  const message =
    typeof value.message === 'string' ? value.message : 'A complete proposal is ready to review.'
  const { roles, workflow } = value
  return normalizeReviewBounds({
    message,
    brainstorm: legacyBrainstorm(),
    review: defaultReview(),
    proposal: { roles, workflow }
  })
}

function normalizeReviewBounds(value: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(value.proposal) || !isRecord(value.proposal.workflow)) return value
  const nodes = value.proposal.workflow.nodes
  if (!Array.isArray(nodes)) return value
  return {
    ...value,
    proposal: {
      ...value.proposal,
      workflow: {
        ...value.proposal.workflow,
        nodes: nodes.map(normalizeReviewNodeBounds)
      }
    }
  }
}

function normalizeReviewNodeBounds(value: unknown): unknown {
  if (!isRecord(value)) return value
  if (value.type === 'review_gate') {
    return {
      ...value,
      minimumDecisions: value.minimumDecisions ?? 1,
      maxRevisionAttempts: value.maxRevisionAttempts ?? 2
    }
  }
  if (value.type === 'human_review_gate') {
    const { minimumDecisions: _minimumDecisions, ...node } = value
    return { ...node, maxRevisionAttempts: node.maxRevisionAttempts ?? 2 }
  }
  const {
    minimumDecisions: _minimumDecisions,
    maxRevisionAttempts: _maxRevisionAttempts,
    ...node
  } = value
  return node
}

function stripUnrecognizedKeys(value: unknown, issues: readonly unknown[]): unknown {
  const sanitized = JSON.parse(JSON.stringify(value)) as unknown
  for (const issue of issues) {
    if (!isRecord(issue) || issue.code !== 'unrecognized_keys' || !Array.isArray(issue.keys)) {
      continue
    }
    const target = valueAtPath(sanitized, Array.isArray(issue.path) ? issue.path : [])
    if (!isRecord(target)) continue
    for (const key of issue.keys) {
      if (typeof key === 'string') delete target[key]
    }
  }
  return sanitized
}

function valueAtPath(value: unknown, path: readonly unknown[]): unknown {
  let current = value
  for (const segment of path) {
    if (typeof segment === 'number' && Array.isArray(current)) current = current[segment]
    else if (typeof segment === 'string' && isRecord(current)) current = current[segment]
    else return undefined
  }
  return current
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
