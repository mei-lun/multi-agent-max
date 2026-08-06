export const PI_APPLICATION_API_EXTENSION_SOURCE = `import { Type } from '@earendil-works/pi-ai'

const endpoint = process.env.MAM_APPLICATION_API_ENDPOINT
const token = process.env.MAM_APPLICATION_API_TOKEN
const enabled = new Set(JSON.parse(process.env.MAM_APPLICATION_API_TOOLS || '[]'))

async function execute(method, request, signal) {
  if (!endpoint || !token) throw new Error('MAM Application API bridge is unavailable')
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ method, request }),
    signal
  })
  const payload = await response.json()
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error?.code + ': ' + (payload.error?.message || 'request failed'))
  }
  return payload.value
}

function toolResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], details: {} }
}

export default function (pi) {
  if (enabled.has('mam_ask_user')) {
    pi.registerTool({
      name: 'mam_ask_user',
      label: 'Ask the user',
      description: 'Pause this Task and ask up to five independent questions. Decision questions require 2-3 options, one recommendation, and a reason. This call waits for the user batch answer.',
      parameters: Type.Object({
        interactionId: Type.String(),
        scope: Type.Union([Type.Literal('task'), Type.Literal('branch'), Type.Literal('run')]),
        kind: Type.Union([Type.Literal('role_questions'), Type.Literal('revision_consultation')]),
        batchId: Type.String(),
        title: Type.String(),
        summary: Type.String(),
        questions: Type.Array(Type.Unknown(), { minItems: 1, maxItems: 5 })
      }),
      async execute(_id, params, signal) {
        return toolResult(await execute('human.request_input', {
          interactionId: params.interactionId,
          scope: params.scope,
          kind: params.kind,
          batch: { id: params.batchId, title: params.title, summary: params.summary, questions: params.questions }
        }, signal))
      }
    })
  }
  if (enabled.has('mam_confirm_understanding')) {
    pi.registerTool({
      name: 'mam_confirm_understanding',
      label: 'Confirm understanding',
      description: 'Submit your understanding after the user answers. This waits for confirmation or returns clarification feedback; do not execute until confirmed is true.',
      parameters: Type.Object({ interactionId: Type.String(), summary: Type.String() }),
      async execute(_id, params, signal) {
        return toolResult(await execute('human.submit_understanding', params, signal))
      }
    })
  }
  if (enabled.has('mam_mcp')) {
    pi.registerTool({
      name: 'mam_mcp',
      label: 'MAM MCP',
      description: 'Call an MCP tool, read an MCP resource, or get an MCP prompt allowed for this role.',
      parameters: Type.Object({
        serverProfileId: Type.String(),
        operation: Type.Union([Type.Literal('call_tool'), Type.Literal('read_resource'), Type.Literal('get_prompt')]),
        toolId: Type.Optional(Type.String()),
        resourceUri: Type.Optional(Type.String()),
        promptId: Type.Optional(Type.String()),
        arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
      }),
      async execute(_id, params, signal) {
        const request = { serverProfileId: params.serverProfileId, operation: params.operation }
        if (params.operation === 'call_tool') {
          request.toolId = params.toolId
          request.arguments = params.arguments || {}
        } else if (params.operation === 'read_resource') {
          request.resourceUri = params.resourceUri
        } else {
          request.promptId = params.promptId
          request.arguments = params.arguments
        }
        return toolResult(await execute('mcp.execute', request, signal))
      }
    })
  }
  if (enabled.has('mam_knowledge_search')) {
    pi.registerTool({
      name: 'mam_knowledge_search',
      label: 'Search knowledge',
      description: 'Search a knowledge base allowed for this role.',
      parameters: Type.Object({
        knowledgeBaseProfileId: Type.String(),
        query: Type.String(),
        collection: Type.Optional(Type.String()),
        topK: Type.Optional(Type.Number()),
        maxContextTokens: Type.Optional(Type.Number())
      }),
      async execute(_id, params, signal) {
        return toolResult(await execute('knowledge.search', params, signal))
      }
    })
  }
  if (enabled.has('mam_knowledge_read')) {
    pi.registerTool({
      name: 'mam_knowledge_read',
      label: 'Read knowledge',
      description: 'Read a document from a knowledge base allowed for this role.',
      parameters: Type.Object({
        knowledgeBaseProfileId: Type.String(),
        documentRef: Type.String(),
        collection: Type.Optional(Type.String())
      }),
      async execute(_id, params, signal) {
        return toolResult(await execute('knowledge.read', params, signal))
      }
    })
  }
}
`
