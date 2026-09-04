import { describe, expect, it } from 'vitest'
import type { McpServerProfile } from '../../../shared/mam/domain/resource-profile'
import { resolveMcpConnection } from './mcp-connection-resolver'

describe('MCP connection resolver', () => {
  it('merges one encrypted credential bundle into only its target connection', () => {
    const profile: McpServerProfile = {
      id: 'mcp.docs',
      version: 1,
      displayName: 'Docs',
      transport: 'stdio',
      connectionRef: 'mcp.docs.connection',
      credentialRef: 'secret.mcp.docs'
    }
    const resolved = resolveMcpConnection(
      profile,
      [
        {
          connectionRef: profile.connectionRef,
          transport: 'stdio',
          command: 'docs-mcp',
          args: [],
          environment: {}
        }
      ],
      {
        'secret.mcp.docs': JSON.stringify({
          environment: { API_TOKEN: 'secret-value' },
          headers: {}
        })
      }
    )

    expect(resolved).toMatchObject({ environment: { API_TOKEN: 'secret-value' } })
  })

  it('retains legacy inline connection values when no credential ref exists', () => {
    const profile: McpServerProfile = {
      id: 'mcp.legacy',
      version: 1,
      displayName: 'Legacy',
      transport: 'http',
      connectionRef: 'legacy.connection'
    }
    expect(
      resolveMcpConnection(
        profile,
        [
          {
            connectionRef: profile.connectionRef,
            transport: 'http',
            url: 'https://example.test/mcp',
            headers: { Authorization: 'Bearer existing' }
          }
        ],
        {}
      )
    ).toMatchObject({ headers: { Authorization: 'Bearer existing' } })
  })
})
