import type {
  McpLocalConnection,
  McpServerProfile
} from '../../../../shared/mam/domain/resource-profile'
import type { MamLocalSettings } from '../../../../shared/mam/local-settings'
import { MamProfileTextField } from './MamProfileFieldControls'

export function MamLocalMcpConnections({
  settings,
  mcpServers,
  onChange
}: Readonly<{
  settings: MamLocalSettings
  mcpServers: readonly McpServerProfile[]
  onChange(settings: MamLocalSettings): void
}>): React.JSX.Element {
  return (
    <fieldset className="space-y-2">
      <div>
        <legend className="text-xs font-medium">Local MCP connections</legend>
        <p className="text-xs text-muted-foreground">
          Configure how this Mac starts or reaches each registered MCP server.
        </p>
      </div>
      {mcpServers.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          Create an MCP server above before configuring its local connection.
        </p>
      ) : (
        <div className="space-y-2">
          {mcpServers.map((profile) => (
            <McpConnectionFields
              key={profile.id}
              profile={profile}
              settings={settings}
              onChange={onChange}
            />
          ))}
        </div>
      )}
    </fieldset>
  )
}

function McpConnectionFields({
  profile,
  settings,
  onChange
}: Readonly<{
  profile: McpServerProfile
  settings: MamLocalSettings
  onChange(settings: MamLocalSettings): void
}>): React.JSX.Element {
  const connection = settings.mcpConnections.find(
    (candidate) => candidate.connectionRef === profile.connectionRef
  )
  const primaryValue = connectionPrimaryValue(connection)
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div>
        <p className="text-xs font-medium">{profile.displayName}</p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {profile.transport} · {profile.connectionRef}
        </p>
      </div>
      <MamProfileTextField
        label={profile.transport === 'stdio' ? 'MCP command' : 'MCP server URL'}
        value={primaryValue}
        placeholder={profile.transport === 'stdio' ? 'office-mcp' : 'https://mcp.example.com'}
        mono
        onChange={(value) => onChange(setMcpConnection(settings, profile, value))}
      />
      {connection?.transport === 'stdio' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <MamProfileTextField
            label="Command arguments"
            value={connection.args.join(', ')}
            placeholder="--stdio, --profile, office"
            mono
            onChange={(value) =>
              onChange(updateMcpConnection(settings, profile.connectionRef, { args: csv(value) }))
            }
          />
          <MamProfileTextField
            label="Working directory (optional)"
            value={connection.cwd ?? ''}
            placeholder="/Users/me/project"
            mono
            onChange={(cwd) =>
              onChange(updateMcpConnectionCwd(settings, profile.connectionRef, cwd))
            }
          />
        </div>
      )}
    </div>
  )
}

export function setMcpConnection(
  settings: MamLocalSettings,
  profile: McpServerProfile,
  value: string
): MamLocalSettings {
  const existing = settings.mcpConnections.find(
    (connection) => connection.connectionRef === profile.connectionRef
  )
  const remaining = settings.mcpConnections.filter(
    (connection) => connection.connectionRef !== profile.connectionRef
  )
  if (!value.trim()) return { ...settings, mcpConnections: remaining }
  const connection: McpLocalConnection =
    profile.transport === 'stdio'
      ? {
          ...(existing?.transport === 'stdio' ? existing : {}),
          connectionRef: profile.connectionRef,
          transport: 'stdio',
          command: value.trim(),
          args: existing?.transport === 'stdio' ? existing.args : [],
          environment: existing?.transport === 'stdio' ? existing.environment : {}
        }
      : {
          ...(existing?.transport === profile.transport ? existing : {}),
          connectionRef: profile.connectionRef,
          transport: profile.transport,
          url: value.trim(),
          headers: existing?.transport === profile.transport ? existing.headers : {}
        }
  return { ...settings, mcpConnections: [...remaining, connection] }
}

function updateMcpConnection(
  settings: MamLocalSettings,
  connectionRef: string,
  change: Partial<Extract<McpLocalConnection, { transport: 'stdio' }>>
): MamLocalSettings {
  return {
    ...settings,
    mcpConnections: settings.mcpConnections.map((connection) =>
      connection.connectionRef === connectionRef && connection.transport === 'stdio'
        ? { ...connection, ...change }
        : connection
    )
  }
}

function connectionPrimaryValue(connection: McpLocalConnection | undefined): string {
  if (!connection) return ''
  return connection.transport === 'stdio' ? connection.command : connection.url
}

function updateMcpConnectionCwd(
  settings: MamLocalSettings,
  connectionRef: string,
  value: string
): MamLocalSettings {
  return {
    ...settings,
    mcpConnections: settings.mcpConnections.map((connection) => {
      if (connection.connectionRef !== connectionRef || connection.transport !== 'stdio') {
        return connection
      }
      const { cwd: _, ...base } = connection
      return value.trim() ? { ...base, cwd: value.trim() } : base
    })
  }
}

function csv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
