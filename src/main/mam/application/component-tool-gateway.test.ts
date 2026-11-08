import { test, expect, vi } from 'vitest'
import { ComponentToolGateway } from './component-tool-gateway'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import type { ComponentToolPort } from './component-tool-port'
import { ExecutorCapabilityBridge } from './executor-capability-bridge'
const jobId = '12345678-1234-4234-8234-123456789abc'
const context = {
  workflowRunId: 'run',
  taskId: 'task',
  attemptId: 'attempt',
  roleInstanceId: 'role',
  executorInvocationId: 'invocation',
  effectiveConfigHash: 'a'.repeat(64)
}
function fixture() {
  const authority = { ...context, nodeRunId: 'node' }
  const prepared = {
    task: { inputArtifacts: [] },
    snapshot: {
      workflowRunId: 'run',
      taskId: 'task',
      attemptId: 'attempt',
      contentHash: context.effectiveConfigHash,
      tools: ['component:creative.image'],
      permissions: { requireApprovalFor: [] },
      componentBindings: [
        {
          componentId: 'creative.image',
          modelProfileId: 'media.model',
          allowedOperations: ['image.generate'],
          model: { id: 'media.model' },
          provider: { secretRef: 'secret' }
        }
      ]
    }
  } as unknown as PreparedAttempt
  const port: ComponentToolPort = {
    listCapabilities: vi.fn(async () => [
      {
        componentId: 'creative.image',
        version: '1.0.0',
        operations: ['image.generate', 'resources.install']
      }
    ]),
    invoke: vi.fn(async () => ({ jobId })),
    status: vi.fn(async () => ({
      jobId,
      state: 'succeeded',
      assets: [],
      request: { apiKey: 'must-not-leak' }
    })),
    cancel: vi.fn(async () => {}),
    dispose: vi.fn(async () => {})
  }
  const gateway = new ComponentToolGateway(prepared, authority, port, new AbortController().signal)
  const call = (method: string, request: unknown = {}, override = context) =>
    gateway.execute({ method, request, context: override })
  return { prepared, port, gateway, call }
}

test.each(['image.edit', 'video.edit'])(
  'zero budget rejects %s before provider invocation',
  async (operation) => {
    const f = fixture()
    f.prepared.snapshot.budget = {
      maxCostUsd: 0,
      maxInputTokens: 100,
      maxOutputTokens: 100,
      maxDurationSeconds: 10
    }
    f.prepared.snapshot.componentBindings![0]!.allowedOperations = [operation]
    await expect(
      f.call('component.invoke', {
        componentId: 'creative.image',
        operation,
        params: { prompt: 'edit' },
        inputArtifacts: [],
        idempotencyKey: 'edit'
      })
    ).rejects.toThrow('zero cost budget')
    expect(f.port.invoke).not.toHaveBeenCalled()
  }
)
test('explicit binding selects media model and strips private backend fields', async () => {
  const f = fixture()
  expect(await f.call('component.listCapabilities')).toEqual([
    { componentId: 'creative.image', version: '1.0.0', operations: ['image.generate'] }
  ])
  await f.call('component.invoke', {
    componentId: 'creative.image',
    operation: 'image.generate',
    params: { prompt: 'paint' },
    inputArtifacts: [],
    idempotencyKey: 'one'
  })
  expect(f.port.invoke).toHaveBeenCalledWith(
    expect.objectContaining({ params: { prompt: 'paint', modelProfileId: 'media.model' } })
  )
  expect(await f.call('component.status', { jobId })).toEqual({
    jobId,
    state: 'succeeded',
    assets: []
  })
  await f.call('component.cancel', { jobId })
  expect(f.port.cancel).toHaveBeenCalledWith(jobId)
})
test('foreign context/job, ungranted refs, disabled operations and model override are denied', async () => {
  const f = fixture(),
    request = {
      componentId: 'creative.image',
      operation: 'image.generate',
      params: { prompt: 'paint' },
      inputArtifacts: [],
      idempotencyKey: 'one'
    }
  await expect(f.call('component.status', { jobId })).rejects.toThrow('not_owned')
  await expect(
    f.call('component.listCapabilities', {}, { ...context, attemptId: 'other' })
  ).rejects.toThrow()
  await expect(
    f.call('component.invoke', { ...request, params: { modelProfileId: 'other' } })
  ).rejects.toThrow('override_denied')
  await expect(
    f.call('component.invoke', {
      ...request,
      inputArtifacts: [{ artifactId: 'other', version: 1, contentHash: 'a'.repeat(64) }]
    })
  ).rejects.toThrow('not_granted')
  vi.mocked(f.port.listCapabilities).mockResolvedValue([])
  await expect(f.call('component.invoke', request)).rejects.toThrow('unavailable')
  expect(f.port.invoke).not.toHaveBeenCalled()
})
test('approval-required policy blocks dispatch and executor cannot forge authority fields', async () => {
  const f = fixture()
  f.prepared.snapshot.permissions.requireApprovalFor.push('network')
  await expect(
    f.call('component.invoke', {
      componentId: 'creative.image',
      operation: 'image.generate',
      params: {},
      inputArtifacts: [],
      idempotencyKey: 'one'
    })
  ).rejects.toThrow('approval_required')
  const bridge = new ExecutorCapabilityBridge(
    {
      executeMcp: async () => {},
      searchKnowledge: async () => {},
      readKnowledge: async () => {},
      componentExecute: (value) => f.gateway.execute(value)
    },
    context
  )
  await expect(
    bridge.execute({
      method: 'component.status',
      request: { jobId, context: { attemptId: 'other' } }
    })
  ).rejects.toThrow()
})
test('owned outputs can feed later operations but arbitrary assets cannot', async () => {
  const f = fixture(),
    ref = { id: jobId, sha256: 'a'.repeat(64), bytes: 1, mime: 'image/png', filename: 'a.png' }
  const request = {
    componentId: 'creative.image',
    operation: 'image.generate',
    params: { prompt: 'paint' },
    inputArtifacts: [],
    idempotencyKey: 'one'
  }
  await expect(f.call('component.invoke', { ...request, inputAssets: [ref] })).rejects.toThrow(
    'asset_not_owned'
  )
  await f.call('component.invoke', request)
  vi.mocked(f.port.status).mockResolvedValue({ jobId, state: 'succeeded', assets: [ref] })
  await f.call('component.status', { jobId })
  await f.call('component.invoke', { ...request, idempotencyKey: 'two', inputAssets: [ref] })
  expect(f.port.invoke).toHaveBeenCalledTimes(2)
})
test('native approval binds frozen request, audits denial and stops on expired claim', async () => {
  const f = fixture(),
    receipts: unknown[] = [],
    controller = new AbortController()
  f.prepared.snapshot.permissions.requireApprovalFor.push('network')
  const gateway = new ComponentToolGateway(
    f.prepared,
    { ...context, nodeRunId: 'node' },
    f.port,
    controller.signal,
    (receipt) => {
      receipts.push(receipt)
    }
  )
  const request = {
    componentId: 'creative.image',
    operation: 'image.generate',
    params: { prompt: 'paint' },
    inputArtifacts: [],
    idempotencyKey: 'one'
  }
  f.port.requestApproval = vi.fn(async (input) => {
    expect(input.request.params.modelProfileId).toBe('media.model')
    expect(input.requestHash).toMatch(/^[a-f0-9]{64}$/)
    return false
  })
  await expect(gateway.execute({ context, method: 'component.invoke', request })).rejects.toThrow(
    'approval_denied'
  )
  expect(f.port.invoke).not.toHaveBeenCalled()
  expect(receipts).toHaveLength(1)
  f.port.requestApproval = async () => {
    controller.abort()
    return true
  }
  await expect(gateway.execute({ context, method: 'component.invoke', request })).rejects.toThrow()
  expect(f.port.invoke).not.toHaveBeenCalled()
})
