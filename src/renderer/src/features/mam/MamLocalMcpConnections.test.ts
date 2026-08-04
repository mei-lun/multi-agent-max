import { describe, expect, it } from 'vitest'
import {
  MamLocalSettingsSchema,
  defaultMamLocalSettings
} from '../../../../shared/mam/local-settings'
import type { McpServerProfile } from '../../../../shared/mam/domain/resource-profile'
import { setMcpConnection } from './MamLocalMcpConnections'

describe('local MCP connections', () => {
  it('stores independent commands for multiple MCP profiles', () => {
    const first = setMcpConnection(
      defaultMamLocalSettings('machine.test'),
      profile('mcp.office', 'connection.office'),
      'office-cli-mcp'
    )
    const second = setMcpConnection(
      first,
      profile('mcp.requirements', 'connection.requirements'),
      'requirements-mcp'
    )

    expect(MamLocalSettingsSchema.parse(second).mcpConnections).toMatchObject([
      { connectionRef: 'connection.office', command: 'office-cli-mcp' },
      { connectionRef: 'connection.requirements', command: 'requirements-mcp' }
    ])
  })
})

function profile(id: string, connectionRef: string): McpServerProfile {
  return { id, version: 1, displayName: id, transport: 'stdio', connectionRef }
}
