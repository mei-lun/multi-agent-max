import { test, expect, vi } from 'vitest'
vi.mock('electron', () => ({ dialog: { showMessageBox: vi.fn() } }))
import { createComponentTools } from './attempt-component-tools'
import type { DesktopCreativeServices } from './desktop-creative-services'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { CreativeJobManager } from '../creative-runtime'
import { attemptComponentUsage } from './attempt-usage-budget'
import type { PreparedAttempt } from '../application/mam-attempt-execution-types'
test('persisted sequential jobs aggregate before another dispatch and publication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'attempt-usage-'))
  const snapshot = {
    attemptId: 'attempt',
    workflowRunId: 'run',
    budget: { maxCostUsd: 1, maxInputTokens: 100, maxOutputTokens: 100, maxDurationSeconds: 10 }
  } as PreparedAttempt['snapshot']
  const jobs = await CreativeJobManager.open({
    directory: join(
      root,
      'component-tool-attempts',
      createHash('sha256').update('attempt').digest('hex')
    ),
    handlers: () => ({
      validate() {},
      async run(_request, context) {
        await context.emit('usage', {
          status: 'partial',
          inputTokens: 60,
          outputTokens: 20,
          costStatus: 'unknown'
        })
        return { text: 'done' }
      }
    })
  })
  const submit = async (key: string) => {
    const id = await jobs.submit({
      componentId: 'creative.writing',
      componentVersion: '1.0.0',
      projectId: 'run',
      operation: 'text.generate',
      attempt: { id: 'attempt', serverId: 'executor' },
      idempotencyKey: key,
      inputAssets: [],
      params: {}
    })
    while (jobs.get(id).state !== 'succeeded')
      await new Promise((resolve) => setTimeout(resolve, 5))
  }
  try {
    await submit('first')
    expect(await attemptComponentUsage(root, snapshot, 'text.generate')).toMatchObject({
      status: 'partial',
      inputTokens: 60
    })
    await submit('second')
    await jobs.dispose()
    await expect(attemptComponentUsage(root, snapshot, 'image.edit')).rejects.toThrow('budget')
    await expect(attemptComponentUsage(root, snapshot)).rejects.toThrow('budget')
    const exact = { ...snapshot, budget: { ...snapshot.budget, maxInputTokens: 120 } }
    expect(await attemptComponentUsage(root, exact)).toMatchObject({
      inputTokens: 120,
      outputTokens: 40,
      status: 'partial'
    })
    await expect(attemptComponentUsage(root, exact, 'text.generate')).rejects.toThrow('exhausted')
  } finally {
    await jobs.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('production role port blocks a third paid dispatch after two completed jobs reach the cap', async () => {
  const root = await mkdtemp(join(tmpdir(), 'attempt-port-budget-'))
  const snapshot = {
    attemptId: 'attempt',
    workflowRunId: 'run',
    tools: ['component:creative.writing'],
    componentBindings: [
      { componentId: 'creative.writing', model: { id: 'model' }, provider: { id: 'provider' } }
    ],
    budget: { maxCostUsd: 1, maxInputTokens: 100, maxOutputTokens: 100, maxDurationSeconds: 10 }
  } as unknown as PreparedAttempt['snapshot']
  const prepared = {
    attemptId: 'attempt',
    workflowRunId: 'run',
    taskId: 'task',
    executorInvocationId: 'executor',
    snapshot,
    credentialValues: {},
    worktree: { path: root },
    task: { outputContracts: [] }
  } as unknown as PreparedAttempt
  let calls = 0
  const services = {
    registry: {
      acquire: async () => ({
        manifest: { version: '1.0.0', operations: [{ id: 'text.generate' }] },
        release() {}
      }),
      acquireVersion: async () => ({
        manifest: { version: '1.0.0', operations: [{ id: 'text.generate' }] },
        release() {}
      })
    },
    runtimeHandlers: () => () => ({
      validate() {},
      async run(_req: unknown, context: { emit: (type: string, data: unknown) => Promise<void> }) {
        calls++
        await context.emit('usage', {
          status: 'known',
          inputTokens: 10,
          outputTokens: 10,
          costUsd: 0.5
        })
        return { text: 'done' }
      }
    })
  } as unknown as DesktopCreativeServices
  const port = createComponentTools({ root, services: async () => services })({
    prepared,
    authority: {
      workflowRunId: 'run',
      taskId: 'task',
      attemptId: 'attempt',
      roleInstanceId: 'role',
      executorInvocationId: 'executor',
      effectiveConfigHash: 'a'.repeat(64),
      nodeRunId: 'node'
    },
    signal: new AbortController().signal
  })
  try {
    for (const key of ['first', 'second']) {
      const { jobId } = await port.invoke({
        componentId: 'creative.writing',
        operation: 'text.generate',
        params: { modelProfileId: 'model' },
        inputArtifacts: [],
        idempotencyKey: key
      })
      while (((await port.status(jobId)) as { state: string }).state !== 'succeeded')
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
    await expect(
      port.invoke({
        componentId: 'creative.writing',
        operation: 'text.generate',
        params: { modelProfileId: 'model' },
        inputArtifacts: [],
        idempotencyKey: 'third'
      })
    ).rejects.toThrow('exhausted')
    expect(calls).toBe(2)
  } finally {
    await port.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
