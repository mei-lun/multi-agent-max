import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'mam-test-server', version: '1.0.0' })

server.registerTool('mcp.search', { inputSchema: { query: z.string() } }, async ({ query }) => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        query,
        pid: process.pid,
        canary: process.env.MAM_MCP_TEST_CANARY,
        inheritedHome: process.env.HOME ?? null
      })
    }
  ]
}))

server.registerResource('scheduler', 'docs://scheduler', {}, async (uri) => ({
  contents: [{ uri: uri.href, text: 'Scheduler resource' }]
}))

server.registerPrompt(
  'prompt.explain',
  { argsSchema: { topic: z.string().optional() } },
  async ({ topic }) => ({
    messages: [
      {
        role: 'user',
        content: { type: 'text', text: `Explain ${topic ?? 'scheduler'}` }
      }
    ]
  })
)

await server.connect(new StdioServerTransport())
