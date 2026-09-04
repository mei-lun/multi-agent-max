import { z } from 'zod'
import { MamEntityIdSchema, Sha256Schema } from './domain/primitives'

export const CodexResourceCandidateSchema = z
  .object({
    key: z.string().min(1).max(1_024),
    kind: z.enum(['skill', 'mcp']),
    resourceId: MamEntityIdSchema,
    displayName: z.string().min(1).max(160),
    source: z
      .object({
        kind: z.enum(['user', 'system', 'plugin', 'config']),
        label: z.string().min(1).max(160),
        path: z.string().min(1).max(16_384)
      })
      .strict(),
    fingerprint: Sha256Schema,
    importState: z.enum(['new', 'updated', 'current', 'unavailable']),
    requiredSecretNames: z.array(z.string().min(1).max(256)),
    unavailableReason: z.string().min(1).max(500).optional()
  })
  .strict()

export const MamImportCodexResourcesInputSchema = z
  .object({
    candidateKeys: z.array(z.string().min(1).max(1_024)).min(1),
    missingSecrets: z.record(z.string(), z.string())
  })
  .strict()

export type CodexResourceCandidate = z.infer<typeof CodexResourceCandidateSchema>
export type MamImportCodexResourcesInput = z.infer<typeof MamImportCodexResourcesInputSchema>
