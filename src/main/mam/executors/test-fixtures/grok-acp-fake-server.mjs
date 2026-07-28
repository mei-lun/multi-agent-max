import process from 'node:process'

let input = ''
process.stderr.write(`fake grok stderr ${process.env.MAM_GROK_PROVIDER_KEY ?? ''}\n`)
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  input += chunk
  while (input.includes('\n')) {
    const newline = input.indexOf('\n')
    const line = input.slice(0, newline).replace(/\r$/, '')
    input = input.slice(newline + 1)
    if (line) handle(JSON.parse(line))
  }
})

const result = JSON.stringify({
  schemaVersion: '1.0.0',
  status: 'submitted',
  summary: 'Grok returned a structured result.',
  verifications: [],
  risks: [],
  followUps: [],
  artifacts: [],
  usage: { status: 'known', inputTokens: 999999, outputTokens: 999999 }
})

function handle(request) {
  if (!('id' in request)) return
  if (request.method === 'initialize') {
    notify('vendor/environment', {
      environmentKeys: Object.keys(process.env).sort(),
      apiKey: process.env.MAM_GROK_PROVIDER_KEY
    })
    respond(request, { protocolVersion: 1 })
    return
  }
  if (request.method === 'session/new') {
    respond(request, { sessionId: 'internal-grok-session' })
    return
  }
  if (request.method === 'session/prompt') {
    const split = Math.floor(result.length / 2)
    notify('session/update', agentChunk(result.slice(0, split)))
    notify('session/update', agentChunk(result.slice(split)))
    notify('session/idle', { naturalLanguage: 'done' })
    respond(request, {
      stopReason: 'end_turn',
      usage: { inputTokens: 12, outputTokens: 8, costUsd: 0.002 }
    })
    return
  }
  respond(request, {})
}

function agentChunk(text) {
  return {
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text }
    }
  }
}

function respond(request, resultValue) {
  write({ jsonrpc: '2.0', id: request.id, result: resultValue })
}

function notify(method, params) {
  write({ jsonrpc: '2.0', method, params })
}

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}
