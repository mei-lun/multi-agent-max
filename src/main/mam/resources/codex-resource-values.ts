import { createHash } from 'node:crypto'

export function candidateKey(kind: 'skill' | 'mcp', identity: string): string {
  return `${kind}:${hashValue(identity)}`
}

export function normalizeResourceId(value: string, prefix: 'skill' | 'mcp'): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '')
  const withPrefix = normalized.startsWith(`${prefix}.`) ? normalized : `${prefix}.${normalized}`
  return withPrefix.slice(0, 128).replace(/[-.:]+$/g, '') || `${prefix}.imported`
}

export function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
}
