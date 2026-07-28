import { z } from 'zod'
import { SystemNodeExecutionSchema } from './domain/system-node-execution'

export function createSystemNodeCommandSchema<T extends z.ZodRawShape>(commandEnvelope: T) {
  return z
    .object({
      ...commandEnvelope,
      type: z.literal('complete_system_node'),
      execution: SystemNodeExecutionSchema
    })
    .strict()
}

export function createSystemNodeEventSchema<T extends z.ZodRawShape>(eventEnvelope: T) {
  return z
    .object({
      ...eventEnvelope,
      type: z.literal('system_node_executed'),
      execution: SystemNodeExecutionSchema
    })
    .strict()
}
