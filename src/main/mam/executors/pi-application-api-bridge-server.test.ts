import { describe, expect, it, vi } from 'vitest'
import type { ExecutorCapabilityBridge } from '../application/executor-capability-bridge'
import { startPiApplicationApiBridge } from './pi-application-api-bridge-server'

describe('Pi Application API bridge server', () => {
  it('accepts only authenticated loopback requests and forwards their structured body', async () => {
    const execute = vi.fn(async () => ({ matches: ['requirements.md'] }))
    const endpoint = await startPiApplicationApiBridge({
      execute
    } as unknown as ExecutorCapabilityBridge)
    const request = {
      method: 'knowledge.search',
      request: { knowledgeBaseProfileId: 'knowledge.requirements', query: 'acceptance' }
    }
    try {
      const rejected = await fetch(endpoint.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request)
      })
      expect(rejected.status).toBe(403)

      const accepted = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${endpoint.token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(request)
      })
      expect(await accepted.json()).toEqual({
        ok: true,
        value: { matches: ['requirements.md'] }
      })
      expect(execute).toHaveBeenCalledOnce()
      expect(execute).toHaveBeenCalledWith(request)
    } finally {
      await endpoint.dispose()
    }
  })
})
