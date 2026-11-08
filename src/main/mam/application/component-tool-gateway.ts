import { assertComponentBudget } from '../components/attempt-component-budget'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { assertComponentOperation } from './component-operation-policy'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import type { AttemptGatewayAuthority } from '../gateways/attempt-gateway-authority'
import {
  assertGatewayContext,
  GatewayRequestContextSchema
} from '../gateways/attempt-gateway-authority'
import {
  ComponentCapabilitySchema,
  ComponentToolInvokeSchema,
  ComponentToolStatusSchema,
  type ComponentToolPort
} from './component-tool-port'
const requestSchema = z
  .object({
    context: GatewayRequestContextSchema,
    method: z.enum([
      'component.listCapabilities',
      'component.invoke',
      'component.status',
      'component.cancel',
      'component.publishOutputs'
    ]),
    request: z.unknown()
  })
  .strict()
export class ComponentToolGateway {
  private owned = new Set<string>()
  private assets = new Set<string>()
  constructor(
    private prepared: PreparedAttempt,
    private authority: AttemptGatewayAuthority,
    private port: ComponentToolPort,
    private signal: AbortSignal,
    private audit: (receipt: Record<string, unknown>) => void = () => {}
  ) {}
  async execute(value: unknown) {
    const input = requestSchema.parse(value),
      snapshot = this.prepared.snapshot
    this.signal.throwIfAborted()
    assertGatewayContext({ context: input.context, authority: this.authority, snapshot })
    if (input.method === 'component.listCapabilities') {
      z.object({}).strict().parse(input.request)
      return z
        .array(ComponentCapabilitySchema)
        .parse(await this.port.listCapabilities())
        .filter((item) => snapshot.tools.includes(`component:${item.componentId}`))
        .map((item) => {
          const binding = snapshot.componentBindings?.find(
            (binding) => binding.componentId === item.componentId
          )
          return {
            ...item,
            operations: item.operations.filter(
              (operation) =>
                !this.maintenance(operation) &&
                (!binding?.allowedOperations || binding.allowedOperations.includes(operation))
            )
          }
        })
    }
    if (input.method === 'component.invoke') {
      const request = ComponentToolInvokeSchema.parse(input.request)
      assertComponentOperation(snapshot, request.componentId, request.operation)
      assertComponentBudget(snapshot, request.operation)
      if (JSON.stringify(request).length > 1024 * 1024)
        throw new Error('component_request_too_large')
      if (
        !snapshot.tools.includes(`component:${request.componentId}`) ||
        this.maintenance(request.operation)
      )
        throw new Error('component_permission_denied')
      const binding = snapshot.componentBindings?.find(
        (binding) => binding.componentId === request.componentId
      )
      if (binding?.allowedOperations && !binding.allowedOperations.includes(request.operation))
        throw new Error('component_operation_denied')
      if (request.inputAssets?.some((ref) => !this.assets.has(JSON.stringify(ref))))
        throw new Error('component_asset_not_owned')
      if (
        request.inputArtifacts.some(
          (ref) =>
            !this.prepared.task.inputArtifacts.some(
              (allowed) =>
                allowed.artifactId === ref.artifactId &&
                allowed.version === ref.version &&
                allowed.contentHash === ref.contentHash
            )
        )
      )
        throw new Error('component_input_not_granted')
      if (/^(image|video|speech|text|vision)\./.test(request.operation)) {
        if (!binding?.model) throw new Error('component_model_binding_required')
        if (request.params.modelProfileId && request.params.modelProfileId !== binding.model.id)
          throw new Error('component_model_override_denied')
        request.params.modelProfileId = binding.model.id
      }
      const capabilities = z
        .array(ComponentCapabilitySchema)
        .parse(await this.port.listCapabilities())
      if (
        !capabilities.some(
          (item) =>
            item.componentId === request.componentId && item.operations.includes(request.operation)
        )
      )
        throw new Error('component_operation_unavailable')
      const categories = snapshot.permissions.requireApprovalFor.filter((kind) =>
        ['command', 'network', 'file'].includes(kind)
      )
      const identity = capabilities.find((item) => item.componentId === request.componentId)
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ request, identity, authority: this.authority }))
        .digest('hex')
      if (categories.length) {
        if (!this.port.requestApproval) throw new Error('component_approval_required')
        const allowed = await this.port.requestApproval({
          request: structuredClone(request),
          requestHash,
          categories
        })
        this.audit({
          type: 'component_approval',
          componentId: request.componentId,
          operation: request.operation,
          requestHash,
          categories,
          allowed,
          identity
        })
        this.signal.throwIfAborted()
        if (!allowed) throw new Error('component_approval_denied')
      }
      this.signal.throwIfAborted()
      const result = z.object({ jobId: z.uuid() }).parse(await this.port.invoke(request))
      this.owned.add(result.jobId)
      return result
    }
    if (input.method === 'component.publishOutputs') {
      const request = z
        .object({ jobId: z.uuid(), contractIds: z.array(z.string().min(1)).min(1).max(100) })
        .strict()
        .parse(input.request)
      if (!this.owned.has(request.jobId)) throw new Error('component_job_not_owned')
      if (!this.port.publishOutputs) throw new Error('component_publish_unavailable')
      return this.port.publishOutputs(request)
    }
    const { jobId } = z.object({ jobId: z.uuid() }).strict().parse(input.request)
    if (!this.owned.has(jobId)) throw new Error('component_job_not_owned')
    if (input.method === 'component.cancel') {
      await this.port.cancel(jobId)
      return { cancelRequested: true }
    }
    const result = ComponentToolStatusSchema.parse(await this.port.status(jobId))
    if (result.jobId !== jobId) throw new Error('component_job_mismatch')
    for (const ref of result.assets) this.assets.add(JSON.stringify(ref))
    return result
  }
  private maintenance(operation: string) {
    return /(^|\.)(resources|install|remove|offline|status|hardware)(\.|$)/.test(operation)
  }
}
