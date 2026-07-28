import { z } from 'zod'
import type { EffectiveRoleConfigSnapshot } from '../../../shared/mam/domain/role'
import { MamEntityIdSchema, Sha256Schema } from '../../../shared/mam/domain/primitives'

export const AttemptGatewayAuthoritySchema = z
  .object({
    workflowRunId: MamEntityIdSchema,
    nodeRunId: MamEntityIdSchema,
    taskId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    roleInstanceId: MamEntityIdSchema,
    executorInvocationId: MamEntityIdSchema,
    effectiveConfigHash: Sha256Schema
  })
  .strict()

export const GatewayRequestContextSchema = AttemptGatewayAuthoritySchema.omit({
  nodeRunId: true
}).strict()

export type AttemptGatewayAuthority = z.infer<typeof AttemptGatewayAuthoritySchema>
export type GatewayRequestContext = z.infer<typeof GatewayRequestContextSchema>

export function assertGatewayContext(input: {
  context: GatewayRequestContext
  authority: AttemptGatewayAuthority
  snapshot: EffectiveRoleConfigSnapshot
}): void {
  const context = GatewayRequestContextSchema.parse(input.context)
  const authority = AttemptGatewayAuthoritySchema.parse(input.authority)
  const expected = {
    workflowRunId: input.snapshot.workflowRunId,
    taskId: input.snapshot.taskId,
    attemptId: input.snapshot.attemptId,
    roleInstanceId: authority.roleInstanceId,
    executorInvocationId: authority.executorInvocationId,
    effectiveConfigHash: input.snapshot.contentHash
  }
  if (JSON.stringify(context) !== JSON.stringify(expected)) {
    throw new AttemptGatewayAuthorityError(
      'gateway_authority_mismatch',
      'Gateway request targets another Attempt or Executor invocation'
    )
  }
  if (
    authority.workflowRunId !== input.snapshot.workflowRunId ||
    authority.taskId !== input.snapshot.taskId ||
    authority.attemptId !== input.snapshot.attemptId ||
    authority.effectiveConfigHash !== input.snapshot.contentHash
  ) {
    throw new AttemptGatewayAuthorityError(
      'gateway_authority_mismatch',
      'Gateway authority does not match the Effective Config'
    )
  }
}

export class AttemptGatewayAuthorityError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AttemptGatewayAuthorityError'
  }
}
