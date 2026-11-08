import { test, expect, vi } from 'vitest'
vi.mock('electron', () => ({ dialog: { showMessageBox: vi.fn() } }))
import { mkdtemp, writeFile, mkdir, rm, readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAttemptGraphCapabilities } from './attempt-graph-capabilities'
import { assertComponentBudget, componentJobUsage } from './attempt-component-budget'
import type { PreparedAttempt } from '../application/mam-attempt-execution-types'
import type { CreativeRequest, CreativeJob } from '../../../shared/mam/creative-runtime'
test('attempt graph enforces operation, path, command, host, approval and conversation scope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'role-graph-')),
    workspace = join(root, 'work')
  await mkdir(workspace)
  await writeFile(join(workspace, 'input.txt'), 'granted text')
  const snapshot = {
    attemptId: 'attempt',
    workflowRunId: 'run',
    tools: ['component:creative.constellation'],
    contentHash: 'a'.repeat(64),
    permissions: {
      readPaths: ['input.txt'],
      allowedCommands: ['echo'],
      deniedCommands: ['echo forbidden'],
      allowedNetworkHosts: ['example.com'],
      requireApprovalFor: ['file', 'network']
    },
    budget: { maxCostUsd: 1, maxDurationSeconds: 5, maxInputTokens: 100, maxOutputTokens: 100 },
    componentBindings: [
      {
        componentId: 'creative.constellation',
        allowedOperations: ['constellation.graph.execute', 'tool.execute', 'text.generate'],
        model: { id: 'model' }
      }
    ]
  } as unknown as PreparedAttempt['snapshot']
  const approve = vi.fn(async () => true),
    run = vi.fn(async () => ({ text: 'reply' }))
  const invoke = createAttemptGraphCapabilities({
    root,
    workspace,
    snapshot,
    authority: { attemptId: 'attempt', workflowRunId: 'run' },
    handlers: () => ({ validate() {}, run }),
    approve
  })
  const request = {
    componentId: 'creative.constellation',
    componentVersion: '1.0.0',
    operation: 'constellation.graph.execute',
    projectId: 'run',
    attempt: { id: 'attempt', serverId: 'executor' },
    idempotencyKey: 'graph',
    inputAssets: [],
    params: {}
  } as CreativeRequest
  const context = { signal: new AbortController().signal, emit: vi.fn(async () => {}) }
  try {
    await expect(
      invoke(request, 'graph.tool', { name: 'read_file', args: { path: 'input.txt' } }, context)
    ).resolves.toBe('granted text')
    expect(approve).toHaveBeenCalledOnce()
    await expect(
      invoke(
        request,
        'graph.authorize',
        { operation: 'image.generate', params: { modelProfileId: 'model' }, inputAssets: [] },
        context
      )
    ).rejects.toThrow('operation_denied')
    for (const call of [
      { name: 'list_files', args: { path: '.' } },
      { name: 'run_command', args: { command: 'echo allowed; bad' } },
      { name: 'run_command', args: { command: 'echo forbidden' } },
      { name: 'web_fetch', args: { url: 'https://ungranted.invalid' } }
    ])
      await expect(invoke(request, 'graph.tool', call, context)).rejects.toThrow('denied')
    expect(approve).toHaveBeenCalledOnce()
    approve.mockResolvedValueOnce(false)
    await expect(
      invoke(
        request,
        'graph.tool',
        { name: 'run_command', args: { command: 'echo hello' } },
        context
      )
    ).rejects.toThrow('approval denied')
    const turn = { modelProfileId: 'model', command: 'first', context: '', inputAssets: [] }
    const first = (await invoke(request, 'graph.conversation', turn, context)) as {
      conversationId: string
    }
    await invoke(
      request,
      'graph.conversation',
      { ...turn, conversationId: first.conversationId, command: 'second' },
      context
    )
    expect(run.mock.calls.length).toBe(2)
    for (const operation of ['image.edit', 'video.edit']) {
      snapshot.componentBindings![0]!.allowedOperations!.push(operation)
      snapshot.budget.maxCostUsd = 0
      await expect(
        invoke(
          request,
          'graph.authorize',
          { operation, params: { modelProfileId: 'model' }, inputAssets: [] },
          context
        )
      ).rejects.toThrow('zero cost budget')
    }
    snapshot.budget.maxCostUsd = 1
    for (const operation of [
      'constellation.graph.execute',
      'music.generate',
      'model3d.start',
      'spine.animation.generate',
      'video.refresh'
    ])
      expect(() =>
        assertComponentBudget(
          { ...snapshot, budget: { ...snapshot.budget, maxCostUsd: 0 } },
          operation
        )
      ).not.toThrow()
    await expect(
      invoke(
        { ...request, attempt: { id: 'foreign', serverId: 'executor' } },
        'graph.conversation',
        turn,
        context
      )
    ).rejects.toThrow('authority')
    snapshot.componentBindings![0]!.allowedOperations = ['constellation.graph.execute']
    await expect(
      invoke(request, 'graph.tool', { name: 'read_file', args: { path: 'input.txt' } }, context)
    ).rejects.toThrow('operation_denied')
    expect(() =>
      assertComponentBudget(
        { ...snapshot, budget: { ...snapshot.budget, maxCostUsd: 0 } },
        'image.generate'
      )
    ).toThrow('zero cost')
    expect(componentJobUsage({ events: [] } as unknown as CreativeJob, snapshot)).toEqual({
      status: 'unknown'
    })
    expect(() =>
      componentJobUsage(
        {
          events: [{ type: 'usage', data: { status: 'known', costUsd: 2 } }]
        } as unknown as CreativeJob,
        snapshot
      )
    ).toThrow('budget')
    snapshot.tools.push('component:creative.writing')
    snapshot.componentBindings!.push({
      componentId: 'creative.writing',
      allowedOperations: ['writing.goal.plan']
    })
    await expect(
      invoke(
        { ...request, componentId: 'creative.writing', operation: 'writing.goal.plan' },
        'operation.authorize',
        { operation: 'text.generate', params: { modelProfileId: 'model' }, inputAssets: [] },
        context
      )
    ).rejects.toThrow('operation_denied')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('conversation locks span callback instances and failed turns leave the durable transcript intact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'graph-turn-lock-'))
  const snapshot = {
    attemptId: 'attempt',
    workflowRunId: 'run',
    tools: ['component:creative.constellation'],
    permissions: { requireApprovalFor: [] },
    budget: { maxCostUsd: 1 },
    componentBindings: [
      {
        componentId: 'creative.constellation',
        allowedOperations: ['constellation.graph.execute', 'text.generate'],
        model: { id: 'model' }
      }
    ]
  } as unknown as PreparedAttempt['snapshot']
  const request = {
    componentId: 'creative.constellation',
    operation: 'constellation.graph.execute',
    componentVersion: '1.0.0',
    projectId: 'run',
    attempt: { id: 'attempt', serverId: 'executor' },
    idempotencyKey: 'job1',
    params: {},
    inputAssets: []
  } as CreativeRequest
  const execution = { signal: new AbortController().signal, emit: async () => {} }
  const prompts: string[] = []
  let finish!: () => void, started!: () => void
  const gate = new Promise<void>((resolve) => {
      finish = resolve
    }),
    entered = new Promise<void>((resolve) => {
      started = resolve
    })
  const make = (run: (request: CreativeRequest) => Promise<{ text: string }>) =>
    createAttemptGraphCapabilities({
      root,
      workspace: root,
      snapshot,
      authority: { attemptId: 'attempt', workflowRunId: 'run' },
      handlers: () => ({ validate() {}, run })
    })
  const normal = make(async (req) => {
    prompts.push(String(req.params.prompt))
    return { text: 'reply' }
  })
  const delayed = make(async (req) => {
    prompts.push(String(req.params.prompt))
    started()
    await gate
    return { text: 'second reply' }
  })
  const input = { modelProfileId: 'model', command: 'first', context: '', inputAssets: [] }
  try {
    const first = (await normal(request, 'graph.conversation', input, execution)) as {
      conversationId: string
    }
    const continuation = { ...input, conversationId: first.conversationId, command: 'second' }
    const pending = delayed(request, 'graph.conversation', continuation, execution)
    await entered
    await expect(
      normal(
        { ...request, idempotencyKey: 'job2' },
        'graph.conversation',
        { ...continuation, command: 'racing' },
        execution
      )
    ).rejects.toThrow('already running')
    finish()
    await pending
    const path = join(
      root,
      'attempt-graph',
      createHash('sha256').update('attempt').digest('hex'),
      `${first.conversationId}.json`
    )
    const before = await readFile(path, 'utf8')
    expect(JSON.parse(before)).toEqual([
      'user: first',
      'assistant: reply',
      'user: second',
      'assistant: second reply'
    ])
    const failed = make(async () => {
      throw Error('provider failed')
    })
    await expect(failed(request, 'graph.conversation', continuation, execution)).rejects.toThrow(
      'provider failed'
    )
    expect(await readFile(path, 'utf8')).toBe(before)
    await normal(request, 'graph.conversation', { ...continuation, command: 'third' }, execution)
    expect(prompts.at(-1)).toContain('assistant: second reply')
    expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(6)
    expect(
      (
        await readdir(
          join(root, 'attempt-graph', createHash('sha256').update('attempt').digest('hex'))
        )
      ).some((name) => name.endsWith('.tmp'))
    ).toBe(false)
  } finally {
    finish()
    await rm(root, { recursive: true, force: true })
  }
})
