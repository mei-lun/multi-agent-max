import { z } from 'zod'
import type {
  McpLocalConnection,
  McpServerProfile
} from '../../../shared/mam/domain/resource-profile'

const McpCredentialBundleSchema = z
  .object({
    environment: z.record(z.string(), z.string()),
    headers: z.record(z.string(), z.string())
  })
  .strict()

export function resolveMcpConnection(
  profile: McpServerProfile,
  connections: readonly McpLocalConnection[],
  credentialValues: Readonly<Record<string, string>>
): McpLocalConnection | undefined {
  const connection = connections.find((item) => item.connectionRef === profile.connectionRef)
  if (!connection || !profile.credentialRef) return connection ? structuredClone(connection) : undefined
  const encoded = credentialValues[profile.credentialRef]
  if (!encoded) throw new Error(`mcp_credential_unavailable:${profile.credentialRef}`)
  const bundle = McpCredentialBundleSchema.parse(JSON.parse(encoded))
  if (connection.transport === 'stdio') {
    return {
      ...connection,
      environment: { ...connection.environment, ...bundle.environment }
    }
  }
  return { ...connection, headers: { ...connection.headers, ...bundle.headers } }
}
