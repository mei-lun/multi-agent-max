import { isAbsolute, resolve } from 'node:path'
import type { CodexResourceCandidate } from '../../../shared/mam/resource-import'
import { CodexResourceCandidateSchema } from '../../../shared/mam/resource-import'
import type {
  McpLocalConnection,
  McpServerProfile
} from '../../../shared/mam/domain/resource-profile'
import {
  candidateKey,
  canonicalJson,
  hashValue,
  isRecord,
  normalizeResourceId,
  stringArray,
  stringRecord
} from './codex-resource-values'

export type ResolvedCodexMcp = Readonly<{
  kind: 'mcp'
  candidate: CodexResourceCandidate
  profile: Omit<McpServerProfile, 'version'>
  connection: McpLocalConnection
  credentials: {
    environment: Record<string, string>
    headers: Record<string, string>
  }
  missingCredentialTargets: Readonly<
    Record<string, Readonly<{ kind: 'environment' | 'header'; key: string; prefix?: string }>>
  >
}>

export function createCodexMcpCandidates(input: {
  servers: unknown
  source: CodexResourceCandidate['source']
  baseDirectory: string
  environment: Readonly<Record<string, string | undefined>>
  importState(
    profile: Omit<McpServerProfile, 'version'>,
    connection: McpLocalConnection,
    credentials: Readonly<{ environment: Record<string, string>; headers: Record<string, string> }>,
    missingCredentialTargets: ResolvedCodexMcp['missingCredentialTargets']
  ): CodexResourceCandidate['importState']
}): ResolvedCodexMcp[] {
  if (!isRecord(input.servers)) return []
  return Object.entries(input.servers).flatMap(([name, raw]) => {
    if (!isRecord(raw) || raw.enabled === false) return []
    try {
      return [createCandidate(name, raw, input)]
    } catch {
      return [unavailableCandidate(name, raw, input)]
    }
  })
}

function unavailableCandidate(
  name: string,
  raw: Record<string, unknown>,
  input: Omit<Parameters<typeof createCodexMcpCandidates>[0], 'servers'>
): ResolvedCodexMcp {
  const resourceId = normalizeResourceId(name, 'mcp')
  const fingerprint = hashValue(canonicalJson(raw))
  const connectionRef = `${resourceId}.connection`
  const candidate = CodexResourceCandidateSchema.parse({
    key: candidateKey('mcp', `${input.source.path}:${name}`, fingerprint),
    kind: 'mcp',
    resourceId,
    displayName: name,
    source: input.source,
    fingerprint,
    importState: 'unavailable',
    requiredSecretNames: [],
    unavailableReason:
      typeof raw.__unavailable_reason === 'string'
        ? raw.__unavailable_reason
        : 'The MCP configuration uses an unsupported format.'
  })
  return {
    kind: 'mcp',
    candidate,
    profile: {
      id: resourceId,
      displayName: name,
      transport: 'stdio',
      connectionRef
    },
    connection: {
      connectionRef,
      transport: 'stdio',
      command: 'unavailable',
      args: [],
      environment: {}
    },
    credentials: { environment: {}, headers: {} },
    missingCredentialTargets: {}
  }
}

function createCandidate(
  name: string,
  raw: Record<string, unknown>,
  input: Omit<Parameters<typeof createCodexMcpCandidates>[0], 'servers'>
): ResolvedCodexMcp {
  const resourceId = normalizeResourceId(name, 'mcp')
  const connectionRef = `${resourceId}.connection`
  const environment = stringRecord(raw.env)
  const missingCredentialTargets: Record<
    string,
    Readonly<{ kind: 'environment' | 'header'; key: string; prefix?: string }>
  > = {}
  const requiredSecretNames = stringArray(raw.env_vars).filter((key) => {
    const value = input.environment[key]
    if (value !== undefined) environment[key] = value
    else missingCredentialTargets[key] = { kind: 'environment', key }
    return value === undefined
  })
  const headers = stringRecord(raw.http_headers)
  for (const [header, environmentKey] of Object.entries(stringRecord(raw.env_http_headers))) {
    const value = input.environment[environmentKey]
    if (value === undefined) {
      requiredSecretNames.push(environmentKey)
      missingCredentialTargets[environmentKey] = { kind: 'header', key: header }
    } else headers[header] = value
  }
  const bearerEnvironment =
    typeof raw.bearer_token_env_var === 'string' ? raw.bearer_token_env_var : undefined
  if (bearerEnvironment) {
    const value = input.environment[bearerEnvironment]
    if (value === undefined) {
      requiredSecretNames.push(bearerEnvironment)
      missingCredentialTargets[bearerEnvironment] = {
        kind: 'header',
        key: 'Authorization',
        prefix: 'Bearer '
      }
    } else {
      headers.Authorization = `Bearer ${value}`
    }
  }
  const hasCredentials =
    Object.keys(environment).length + Object.keys(headers).length + requiredSecretNames.length > 0
  const profileBase = {
    id: resourceId,
    displayName: name,
    connectionRef,
    ...(hasCredentials ? { credentialRef: `secret.${resourceId}` } : {})
  }
  const connection = createConnection(raw, connectionRef, input.baseDirectory)
  const profile = { ...profileBase, transport: connection.transport }
  const fingerprint = hashValue(
    canonicalJson({
      profile,
      connection,
      secretHash: hashValue(canonicalJson({ environment, headers }))
    })
  )
  const candidate = CodexResourceCandidateSchema.parse({
    key: candidateKey('mcp', `${input.source.path}:${name}`, fingerprint),
    kind: 'mcp',
    resourceId,
    displayName: name,
    source: input.source,
    fingerprint,
    importState: input.importState(
      profile,
      connection,
      { environment, headers },
      missingCredentialTargets
    ),
    requiredSecretNames: [...new Set(requiredSecretNames)].sort()
  })
  return {
    kind: 'mcp',
    candidate,
    profile,
    connection,
    credentials: { environment, headers },
    missingCredentialTargets
  }
}

function createConnection(
  raw: Record<string, unknown>,
  connectionRef: string,
  baseDirectory: string
): McpLocalConnection {
  if (typeof raw.command === 'string' && raw.command.trim()) {
    const cwd = typeof raw.cwd === 'string' && raw.cwd.trim() ? raw.cwd.trim() : undefined
    return {
      connectionRef,
      transport: 'stdio',
      command: raw.command.trim(),
      args: stringArray(raw.args),
      ...(cwd ? { cwd: isAbsolute(cwd) ? cwd : resolve(baseDirectory, cwd) } : {}),
      environment: {}
    }
  }
  if (typeof raw.url === 'string') {
    const transport = raw.type === 'sse' ? 'sse' : 'http'
    return { connectionRef, transport, url: raw.url, headers: {} }
  }
  throw new Error('unsupported_mcp_transport')
}
