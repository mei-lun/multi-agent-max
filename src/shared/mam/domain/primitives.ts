import { z } from 'zod'

export const MAM_DOMAIN_SCHEMA_VERSION = '1.0.0' as const
export const MamSchemaVersionSchema = z.literal(MAM_DOMAIN_SCHEMA_VERSION)
export const MamEntityIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
export const IsoTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/)

export type MamSchemaVersion = z.infer<typeof MamSchemaVersionSchema>
