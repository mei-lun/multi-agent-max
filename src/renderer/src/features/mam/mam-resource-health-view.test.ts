import { describe, expect, it } from 'vitest'
import { resourceHealthView } from './mam-resource-health-view'

describe('resource health view', () => {
  it('maps a current incompatible result and ignores another version', () => {
    const view = resourceHealthView('mcp', 'mcp.docs', 2, [
      {
        kind: 'mcp',
        resourceId: 'mcp.docs',
        version: 1,
        fingerprint: 'a'.repeat(64),
        status: 'healthy',
        checkedAt: '2026-09-03T00:00:00Z',
        stage: 'mcp.capabilities'
      },
      {
        kind: 'mcp',
        resourceId: 'mcp.docs',
        version: 2,
        fingerprint: 'b'.repeat(64),
        status: 'pi-incompatible',
        checkedAt: '2026-09-04T00:00:00Z',
        stage: 'mcp.capabilities',
        code: 'mcp_timeout',
        message: 'The MCP server could not initialize or list capabilities.'
      }
    ])

    expect(view).toMatchObject({
      label: 'Pi incompatible',
      message: 'The MCP server could not initialize or list capabilities.'
    })
  })

  it('returns unchecked when there is no current result', () => {
    expect(resourceHealthView('skill', 'skill.release', 1, [])).toEqual({
      label: 'Unchecked',
      variant: 'outline'
    })
  })
})
