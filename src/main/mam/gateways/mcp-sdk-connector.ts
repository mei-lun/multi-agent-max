import { isAbsolute } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import {
  DEFAULT_INHERITED_ENV_VARS,
  StdioClientTransport
} from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'
import { z } from 'zod'
import type { McpServerProfile } from '../../../shared/mam/domain/resource-profile'
import type { McpCapabilityRequest, McpConnector } from './mcp-capability-gateway'

const ConnectionBaseSchema = z.object({
  connectionRef: z.string().min(1)
})

export const McpLocalConnectionSchema = z.discriminatedUnion('transport', [
  ConnectionBaseSchema.extend({
    transport: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()),
    cwd: z.string().min(1).optional(),
    environment: z.record(z.string(), z.string())
  }).strict(),
  ConnectionBaseSchema.extend({
    transport: z.literal('http'),
    url: z.url(),
    headers: z.record(z.string(), z.string())
  }).strict(),
  ConnectionBaseSchema.extend({
    transport: z.literal('sse'),
    url: z.url(),
    headers: z.record(z.string(), z.string())
  }).strict()
])

export type McpLocalConnection = z.infer<typeof McpLocalConnectionSchema>
export type McpConnectionResolver = (
  connectionRef: string
) => McpLocalConnection | undefined | Promise<McpLocalConnection | undefined>

type McpClientPort = Readonly<{
  callTool(
    input: { name: string; arguments: Record<string, unknown> },
    options: RequestOptions
  ): Promise<unknown>
  readResource(input: { uri: string }, options: RequestOptions): Promise<unknown>
  getPrompt(
    input: { name: string; arguments?: Record<string, string> },
    options: RequestOptions
  ): Promise<unknown>
  close(): Promise<void>
}>

type McpClientFactory = (
  profile: McpServerProfile,
  connection: McpLocalConnection,
  timeoutMs: number
) => Promise<McpClientPort>

export class McpSdkConnectorError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'McpSdkConnectorError'
  }
}

export class McpSdkConnector implements McpConnector {
  private readonly clients = new Map<string, Promise<McpClientPort>>()

  constructor(
    private readonly resolveConnection: McpConnectionResolver,
    private readonly timeoutMs = 30_000,
    private readonly createClient: McpClientFactory = connectSdkClient
  ) {}

  async execute(profile: McpServerProfile, request: McpCapabilityRequest): Promise<unknown> {
    const client = await this.clientFor(profile)
    const options = { timeout: this.timeoutMs, maxTotalTimeout: this.timeoutMs }
    if (request.operation === 'call_tool') {
      return client.callTool({ name: request.toolId, arguments: request.arguments }, options)
    }
    if (request.operation === 'read_resource') {
      return client.readResource({ uri: request.resourceUri }, options)
    }
    return client.getPrompt(
      {
        name: request.promptId,
        ...(request.arguments ? { arguments: request.arguments } : {})
      },
      options
    )
  }

  async dispose(): Promise<void> {
    const clients = [...this.clients.values()]
    this.clients.clear()
    await Promise.all(
      clients.map(async (client) => {
        try {
          await (await client).close()
        } catch {
          // Disposal is best-effort after the capability boundary has closed.
        }
      })
    )
  }

  private clientFor(profile: McpServerProfile): Promise<McpClientPort> {
    const key = `${profile.id}@${profile.version}`
    const existing = this.clients.get(key)
    if (existing) return existing
    const connection = this.connect(profile)
    this.clients.set(key, connection)
    void connection.catch(() => this.clients.delete(key))
    return connection
  }

  private async connect(profile: McpServerProfile): Promise<McpClientPort> {
    const resolved = await this.resolveConnection(profile.connectionRef)
    if (!resolved) {
      fail('mcp_connection_unavailable', `MCP connection ${profile.connectionRef} is unavailable`)
    }
    const connection = McpLocalConnectionSchema.parse(resolved)
    if (connection.connectionRef !== profile.connectionRef) {
      fail('mcp_connection_mismatch', 'Local MCP connection resolved another reference')
    }
    if (connection.transport !== profile.transport) {
      fail('mcp_transport_mismatch', 'Local MCP transport does not match the pinned Profile')
    }
    if (connection.transport === 'stdio' && connection.cwd && !isAbsolute(connection.cwd)) {
      fail('mcp_cwd_not_absolute', 'MCP stdio cwd must be absolute')
    }
    if (connection.transport === 'sse' && Object.keys(connection.headers).length > 0) {
      fail(
        'mcp_sse_headers_unsupported',
        'Legacy SSE credentials require an explicit OAuth provider'
      )
    }
    return this.createClient(profile, connection, this.timeoutMs)
  }
}

async function connectSdkClient(
  _profile: McpServerProfile,
  connection: McpLocalConnection,
  timeoutMs: number
): Promise<McpClientPort> {
  const transport = createTransport(connection)
  const client = new Client({ name: 'multi-agent-max', version: '0.1.0' }, { capabilities: {} })
  // The SDK's HTTP transport narrows an optional field incompatibly under exactOptionalPropertyTypes.
  await client.connect(transport as Parameters<Client['connect']>[0], {
    timeout: timeoutMs,
    maxTotalTimeout: timeoutMs
  })
  return {
    callTool: (input, options) => client.callTool(input, undefined, options),
    readResource: (input, options) => client.readResource(input, options),
    getPrompt: (input, options) => client.getPrompt(input, options),
    close: () => client.close()
  }
}

function createTransport(connection: McpLocalConnection) {
  if (connection.transport === 'stdio') {
    const transport = new StdioClientTransport({
      command: connection.command,
      args: connection.args,
      ...(connection.cwd ? { cwd: connection.cwd } : {}),
      env: minimalEnvironment(connection.environment),
      stderr: 'pipe'
    })
    // Prevent server diagnostics from bypassing MAM's redacted audit path.
    transport.stderr?.on('data', () => undefined)
    return transport
  }
  if (connection.transport === 'http') {
    return new StreamableHTTPClientTransport(new URL(connection.url), {
      requestInit: { headers: connection.headers }
    })
  }
  return new SSEClientTransport(new URL(connection.url))
}

function minimalEnvironment(extra: Readonly<Record<string, string>>): Record<string, string> {
  const allowed = [
    'COMSPEC',
    'LANG',
    'LC_ALL',
    'PATH',
    'PATHEXT',
    'SHELL',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'TMPDIR',
    'WINDIR'
  ]
  const inherited = Object.fromEntries(
    allowed.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]!]]))
  )
  const neutralizedDefaults = Object.fromEntries(
    DEFAULT_INHERITED_ENV_VARS.filter((key) => !(key in inherited)).map((key) => [key, ''])
  )
  return {
    // The SDK re-adds its defaults, so empty overrides prevent ambient identity leakage.
    ...neutralizedDefaults,
    ...inherited,
    ...extra
  }
}

function fail(code: string, message: string): never {
  throw new McpSdkConnectorError(code, message)
}
