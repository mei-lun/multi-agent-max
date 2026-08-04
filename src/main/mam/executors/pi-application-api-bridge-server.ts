import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { ExecutorCapabilityBridge } from '../application/executor-capability-bridge'

const MAX_REQUEST_BYTES = 1_000_000

export type PiApplicationApiBridgeEndpoint = Readonly<{
  url: string
  token: string
  dispose(): Promise<void>
}>

export async function startPiApplicationApiBridge(
  bridge: ExecutorCapabilityBridge
): Promise<PiApplicationApiBridgeEndpoint> {
  const token = randomBytes(32).toString('base64url')
  const server = createServer((request, response) => {
    void handleRequest(bridge, token, request, response)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('Pi Application API bridge did not bind a loopback port')
  }
  return {
    url: `http://127.0.0.1:${address.port}/execute`,
    token,
    dispose: () => closeServer(server)
  }
}

async function handleRequest(
  bridge: ExecutorCapabilityBridge,
  token: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  response.setHeader('content-type', 'application/json')
  if (
    request.method !== 'POST' ||
    request.url !== '/execute' ||
    request.headers.authorization !== `Bearer ${token}`
  ) {
    response.statusCode = 403
    response.end(JSON.stringify({ ok: false, error: { code: 'bridge_request_rejected' } }))
    return
  }
  try {
    const value = await bridge.execute(JSON.parse(await readBody(request)))
    response.end(JSON.stringify({ ok: true, value }))
  } catch (error) {
    response.statusCode = 400
    response.end(
      JSON.stringify({
        ok: false,
        error: {
          code: errorCode(error),
          message: error instanceof Error ? error.message : String(error)
        }
      })
    )
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = ''
  for await (const chunk of request) {
    body += chunk.toString('utf8')
    if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new Error('bridge_request_too_large')
  }
  return body
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : 'bridge_request_failed'
}
