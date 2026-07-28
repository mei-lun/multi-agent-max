import { z } from 'zod'

export const GrokAcpNotificationSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    method: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional()
  })
  .strict()

export type GrokAcpNotification = z.infer<typeof GrokAcpNotificationSchema>
export type GrokAcpResponse = Readonly<{
  jsonrpc: '2.0'
  id: string | number
  result?: Record<string, unknown>
  error?: { code: number; message: string; data?: unknown }
}>

export type GrokAcpTransport = Readonly<{
  start(): Promise<void>
  stop(): Promise<void>
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>
  notify(method: string, params?: Record<string, unknown>): Promise<void>
  onNotification(listener: (notification: GrokAcpNotification) => void): () => void
  onExit(listener: (error?: Error) => void): () => void
  getStderr(): string
}>

export class GrokAcpProtocolError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'GrokAcpProtocolError'
  }
}

export function assertGrokAcpResponse(response: GrokAcpResponse): Record<string, unknown> {
  if (response.error) {
    throw new GrokAcpProtocolError(`rpc_${response.error.code}`, response.error.message)
  }
  return response.result ?? {}
}
