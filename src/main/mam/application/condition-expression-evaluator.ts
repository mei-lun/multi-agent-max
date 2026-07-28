export class ConditionExpressionError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ConditionExpressionError'
  }
}

export function evaluateConditionExpression(input: {
  expression: string
  artifacts: Readonly<Record<string, unknown>>
}): unknown {
  const expression = input.expression.trim()
  const comparison = expression.match(/^(.*?)\s*(===|==|!==|!=)\s*(.*?)$/)
  if (comparison) {
    const left = resolveOperand(comparison[1]!, input.artifacts)
    const right = resolveOperand(comparison[3]!, input.artifacts)
    const equal = deepEqual(left, right)
    return comparison[2] === '==' || comparison[2] === '===' ? equal : !equal
  }
  return resolveOperand(expression, input.artifacts)
}

export function selectConditionBranch(input: {
  expression: string
  artifacts: Readonly<Record<string, unknown>>
  branches: Readonly<Record<string, string>>
}): string {
  const value = evaluateConditionExpression(input)
  const candidates =
    typeof value === 'boolean' ? (value ? ['true', 'yes'] : ['false', 'no']) : [String(value)]
  const branch = candidates.find((candidate) => Object.hasOwn(input.branches, candidate))
  if (!branch) {
    throw new ConditionExpressionError(
      'condition_branch_unmatched',
      `Condition expression resolved to ${JSON.stringify(value)} without a declared branch`
    )
  }
  return branch
}

function resolveOperand(expression: string, artifacts: Readonly<Record<string, unknown>>): unknown {
  const source = expression.trim()
  if (source === 'true') return true
  if (source === 'false') return false
  if (source === 'null') return null
  if (/^-?\d+(?:\.\d+)?$/.test(source)) return Number(source)
  if (
    (source.startsWith('"') && source.endsWith('"')) ||
    (source.startsWith("'") && source.endsWith("'"))
  ) {
    return source.slice(1, -1)
  }
  const artifactPath = source.match(/^artifact\["([^"\\]+)"\](?:\.([A-Za-z0-9_.-]+))?$/)
  if (artifactPath) {
    const artifact = artifacts[artifactPath[1]!]
    if (artifact === undefined) {
      throw new ConditionExpressionError(
        'condition_artifact_missing',
        `Condition references unavailable Artifact ${artifactPath[1]}`
      )
    }
    return artifactPath[2] ? readPath(artifact, artifactPath[2]!) : artifact
  }
  return resolveUniqueProperty(source, artifacts)
}

function resolveUniqueProperty(
  property: string,
  artifacts: Readonly<Record<string, unknown>>
): unknown {
  const matches = Object.values(artifacts).flatMap((artifact) => {
    if (!isRecord(artifact) || !Object.hasOwn(artifact, property)) return []
    return [artifact[property]]
  })
  if (matches.length !== 1) {
    throw new ConditionExpressionError(
      matches.length === 0 ? 'condition_property_missing' : 'condition_property_ambiguous',
      `Condition property ${property} must appear in exactly one structured Artifact`
    )
  }
  return matches[0]
}

function readPath(value: unknown, path: string): unknown {
  let current = value
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      throw new ConditionExpressionError(
        'condition_property_missing',
        `Condition path ${path} is unavailable`
      )
    }
    current = current[segment]
  }
  return current
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
