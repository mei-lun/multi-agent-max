import process from 'node:process'

process.stderr.write('fake pi stderr mam-canary-secret-stderr\n')
process.stdout.write('this-is-not-json\n')

const result = {
  schemaVersion: '1.0.0',
  status: 'submitted',
  summary: 'Pi returned a structured result.',
  verifications: [],
  risks: [],
  followUps: [],
  artifacts: [],
  usage: { status: 'known', inputTokens: 999999, outputTokens: 999999 }
}

let input = ''
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

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function respond(command, data) {
  write({
    id: command.id,
    type: 'response',
    command: command.type,
    success: true,
    ...(data === undefined ? {} : { data })
  })
}

function handle(command) {
  if (command.type === 'get_last_assistant_text') {
    respond(command, { text: JSON.stringify(result) })
    return
  }
  if (command.type === 'get_session_stats') {
    respond(command, {
      sessionFile: undefined,
      sessionId: 'fake-session-1',
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 2,
      tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, total: 18 },
      cost: 0.001,
      contextUsage: { tokens: 15, contextWindow: 1000, percent: 1.5 }
    })
    return
  }
  respond(command)
  if (command.type === 'prompt') {
    setTimeout(() => {
      write({
        type: 'agent_start',
        environmentKeys: Object.keys(process.env).sort(),
        apiKey: process.env.MAM_PI_PROVIDER_KEY
      })
      write({ type: 'turn_start', turnIndex: 0 })
      write({ type: 'agent_settled' })
    }, 5)
  }
}
