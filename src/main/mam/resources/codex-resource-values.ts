import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { ValidatedSkillPackage } from '../skills/skill-package-validator'
import type {
  McpLocalConnection,
  McpServerProfile
} from '../../../shared/mam/domain/resource-profile'

export function candidateKey(kind: 'skill' | 'mcp', identity: string, fingerprint: string): string {
  return `${kind}:${hashValue(`${identity}:${fingerprint}`)}`
}

export function normalizeResourceId(value: string, prefix: 'skill' | 'mcp'): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
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
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

export function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
}

export function compareResourceVersions(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true })
}

export function credentialsMatchSource(
  storedSource: string | undefined,
  expected: Readonly<{ environment: Record<string, string>; headers: Record<string, string> }>,
  missingTargets: Readonly<
    Record<string, Readonly<{ kind: 'environment' | 'header'; key: string }>>
  >
): boolean {
  if (!storedSource) return false
  try {
    const stored = JSON.parse(storedSource) as typeof expected
    const expectedEnvironmentKeys = new Set(Object.keys(expected.environment))
    const expectedHeaderKeys = new Set(Object.keys(expected.headers))
    for (const target of Object.values(missingTargets)) {
      ;(target.kind === 'environment' ? expectedEnvironmentKeys : expectedHeaderKeys).add(
        target.key
      )
    }
    if (
      !sameKeys(expectedEnvironmentKeys, Object.keys(stored.environment ?? {})) ||
      !sameKeys(expectedHeaderKeys, Object.keys(stored.headers ?? {}))
    ) {
      return false
    }
    const knownMatch =
      Object.entries(expected.environment).every(
        ([key, value]) => stored.environment?.[key] === value
      ) && Object.entries(expected.headers).every(([key, value]) => stored.headers?.[key] === value)
    const missingPresent = Object.values(missingTargets).every((target) =>
      target.kind === 'environment'
        ? Boolean(stored.environment?.[target.key])
        : Boolean(stored.headers?.[target.key])
    )
    return knownMatch && missingPresent
  } catch {
    return false
  }
}

function sameKeys(expected: ReadonlySet<string>, actual: readonly string[]): boolean {
  return expected.size === actual.length && actual.every((key) => expected.has(key))
}

export function unavailableSkill(path: string, name: string): ValidatedSkillPackage {
  return { canonicalPath: path, name, description: '', contentDigest: hashValue(path) }
}

export function skillDiscoveryError(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error)
  return code.includes('missing_skill_md')
    ? 'SKILL.md is missing.'
    : 'The Skill package could not be read.'
}

export function discoveryErrorCode(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function unavailableMcp(name: string, reason: string): Record<string, unknown> {
  return { [name]: { __unavailable_reason: reason } }
}

export function safeResolveSecret(
  secrets: Readonly<{ resolveSecret(secretRef: string): string | undefined }> | undefined,
  secretRef: string
): string | undefined {
  try {
    return secrets?.resolveSecret(secretRef)
  } catch {
    return undefined
  }
}

export function mcpImportState(input: {
  profile: Omit<McpServerProfile, 'version'>
  connection: McpLocalConnection
  credentials: Readonly<{ environment: Record<string, string>; headers: Record<string, string> }>
  missingTargets: Readonly<
    Record<string, Readonly<{ kind: 'environment' | 'header'; key: string }>>
  >
  active: McpServerProfile | undefined
  local: McpLocalConnection | undefined
  storedCredentials: string | undefined
}): 'new' | 'updated' | 'current' {
  if (!input.active) return 'new'
  const { version: _version, ...activeContent } = input.active
  const credentialMatches =
    !input.profile.credentialRef ||
    credentialsMatchSource(input.storedCredentials, input.credentials, input.missingTargets)
  return canonicalJson(activeContent) === canonicalJson(input.profile) &&
    canonicalJson(input.local) === canonicalJson(input.connection) &&
    credentialMatches
    ? 'current'
    : 'updated'
}

export function configuredSkillPaths(
  config: Record<string, unknown>,
  codexHome: string,
  enabled: boolean
): Set<string> {
  if (!isRecord(config.skills) || !Array.isArray(config.skills.config)) return new Set()
  return new Set(
    config.skills.config.flatMap((entry) => {
      if (!isRecord(entry) || entry.enabled !== enabled || typeof entry.path !== 'string') return []
      const path = resolve(codexHome, entry.path)
      return [path.toLowerCase().endsWith('skill.md') ? resolve(path, '..') : path]
    })
  )
}
